import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkflow } from '../scripts/runtime.mjs';

test('omitted args remain undefined in parent and child workflows', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  const script = '/* autocode {"name":"parent","description":"Check omitted input"} */\nreturn [typeof args, await workflow("child")];';
  const child = '/* autocode {"name":"child","description":"Check omitted input"} */\nreturn typeof args;';
  try {
    const output = await runWorkflow({ script, runDir, resolveWorkflow: async () => child,
      agent: async () => { throw Error('unused'); } });
    assert.deepEqual(output.result, ['undefined', 'undefined']);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('child workflow accepts a scriptPath reference', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  const script = '/* autocode {"name":"parent","description":"Run child file"} */\nreturn await workflow({scriptPath:"/tmp/child.js"},{value:7});';
  const child = '/* autocode {"name":"child","description":"Read child input"} */\nreturn args.value;';
  try {
    const output = await runWorkflow({ script, runDir, resolveWorkflow: async (reference) => {
      assert.deepEqual(JSON.parse(JSON.stringify(reference)), { scriptPath: '/tmp/child.js' });
      return child;
    }, agent: async () => { throw Error('unused'); } });
    assert.equal(output.result, 7);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('runs a workflow with the recovered export const meta header', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  const script = `export const meta = {
    name: 'exported',
    description: 'Use recovered syntax',
    phases: [{ title: 'Read', detail: 'one' }],
  };
  phase('Read');
  return args.value;`;
  try {
    const output = await runWorkflow({ script, args: { value: 9 }, runDir,
      agent: async () => { throw Error('unused'); } });
    assert.equal(output.result, 9);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('resume refuses a run ID from another directory', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  const script = '/* autocode {"name":"resume","description":"Check run identity"} */\nreturn 1;';
  try {
    await runWorkflow({ script, runDir, agent: async () => { throw Error('unused'); } });
    await assert.rejects(runWorkflow({ script, runDir, resumeFromRunId: 'wf_other',
      agent: async () => { throw Error('unused'); } }), /resume run ID does not match/);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('resume surfaces a malformed journal instead of treating it as empty', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  const script = '/* autocode {"name":"resume","description":"Check journal error"} */\nreturn 1;';
  try {
    const first = await runWorkflow({ script, runDir, agent: async () => { throw Error('unused'); } });
    await mkdir(join(runDir, 'journal.jsonl'));
    await assert.rejects(runWorkflow({ script, runDir, resumeFromRunId: first.runId,
      agent: async () => { throw Error('unused'); } }), /EISDIR/);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('invalid agent usage fails visibly and records the failure', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  const script = '/* autocode {"name":"invalid-usage","description":"Reject bad adapter result"} */\nreturn await agent("one");';
  try {
    await assert.rejects(runWorkflow({ script, runDir,
      agent: async () => ({ result: 'text', outputTokens: -1 }) }), /non-negative outputTokens/);
    assert.match(await readFile(join(runDir, 'journal.jsonl'), 'utf8'), /"type":"failed"/);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('workflow can cancel a timer and rejects dynamic imports', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  const script = '/* autocode {"name":"globals","description":"Check workflow globals"} */\nconst id=setTimeout(()=>{throw Error("uncancelled")},20);clearTimeout(id);try{await import("node:fs")}catch(e){return e.message}';
  try {
    const output = await runWorkflow({ script, runDir,
      agent: async () => { throw Error('unused'); } });
    assert.match(output.result, /dynamic import callback|import\(\) is unavailable/);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('phase and log stream progress while a workflow is running', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  const events = [];
  let completed = false;
  const script = '/* autocode {"name":"progress","description":"Show live progress"} */\nphase("Scan");log("started");await new Promise(r=>setTimeout(r,5));return 1;';
  try {
    const pending = runWorkflow({ script, runDir, onProgress: event => {
      assert.equal(completed, false);
      events.push(event);
    },
      agent: async () => { throw Error('unused'); } });
    await pending;
    completed = true;
    assert.deepEqual(events, [{ type: 'phase', title: 'Scan' },
      { type: 'log', phase: 'Scan', message: 'started' }]);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('agent progress uses its label and explicit phase', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  const events = [];
  const script = '/* autocode {"name":"agent-progress","description":"Track an agent"} */\nphase("Review");return await agent("check",{label:"checker",phase:"Verify"});';
  try {
    await runWorkflow({ script, runDir, onProgress: event => events.push(event),
      agent: async () => ({ result: 'done', outputTokens: 1 }) });
    assert.deepEqual(events.filter(event => event.type.startsWith('agent-')), [
      { type: 'agent-started', label: 'checker', phase: 'Verify' },
      { type: 'agent-completed', label: 'checker', phase: 'Verify' },
    ]);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('failed agent calls report failure progress', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  const events = [];
  const script = '/* autocode {"name":"failure-progress","description":"Track failure"} */\ntry{await agent("check",{label:"checker"})}catch{return "caught"}';
  try {
    const output = await runWorkflow({ script, runDir, onProgress: event => events.push(event),
      agent: async () => { throw Error('failed'); } });
    assert.equal(output.result, 'caught');
    assert.deepEqual(events, [
      { type: 'agent-started', label: 'checker', phase: null },
      { type: 'agent-failed', label: 'checker', phase: null },
    ]);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('runs an async workflow with JSON args', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  try {
    const script = '/* autocode {"name":"sum","description":"Add inputs"} */\nreturn args.a + args.b;';
    const output = await runWorkflow({ script, args: { a: 2, b: 3 }, runDir, agent: async () => { throw Error('unused'); } });
    assert.equal(output.result, 5);
    assert.equal(output.agentCount, 0);
    assert.match(output.runId, /^wf_/);
    const saved = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8'));
    assert.equal(saved.script, script);
    assert.deepEqual(saved.args, { a: 2, b: 3 });
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('returns an agent result and counts its output tokens', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  try {
    const script = '/* autocode {"name":"delegate","description":"Delegate one question"} */\nreturn await agent("Answer the question");';
    const output = await runWorkflow({
      script, runDir, budget: 10,
      agent: async (prompt) => {
        assert.equal(prompt, 'Answer the question');
        return { result: '42', outputTokens: 4 };
      },
    });
    assert.equal(output.result, '42');
    assert.equal(output.agentCount, 1);
    assert.equal(output.outputTokens, 4);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('parallel preserves order, caps concurrent agents, and reports failed slots', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  let active = 0, peak = 0;
  try {
    const script = '/* autocode {"name":"fanout","description":"Run independent tasks"} */\nreturn await parallel([()=>agent("a"),()=>agent("b"),()=>agent("c"),()=>{throw Error("boom")}]);';
    const output = await runWorkflow({ script, runDir, concurrency: 2, agent: async (prompt) => {
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, prompt === 'a' ? 15 : 2));
      active--;
      return { result: prompt, outputTokens: 1 };
    } });
    assert.deepEqual(output.result, ['a', 'b', 'c', null]);
    assert.equal(peak, 2);
    assert.equal(output.failures.length, 1);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('pipeline advances items independently and skips later stages after null', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  try {
    const script = '/* autocode {"name":"pipeline","description":"Process each item"} */\nconst order=[]; const values=await pipeline([0,1], async x=>{if(x===0)await new Promise(r=>setTimeout(r,15));order.push("a"+x);return x}, x=>{order.push("b"+x);return x===0?null:x+10}, x=>{order.push("c"+x);return x+1}); return {values,order};';
    const output = await runWorkflow({ script, runDir, agent: async () => { throw Error('unused'); } });
    assert.deepEqual(output.result, { values: [null, 12], order: ['a1', 'b1', 'c11', 'a0', 'b0'] });
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('phase and log return visible progress with the workflow result', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  try {
    const script = '/* autocode {"name":"progress","description":"Report progress"} */\nphase("Scan"); log("started"); return args.target;';
    const output = await runWorkflow({ script, args: { target: 'src' }, runDir,
      agent: async () => { throw Error('unused'); } });
    assert.equal(output.result, 'src');
    assert.deepEqual(output.logs, [{ phase: 'Scan', message: 'started' }]);
    const events = await readFile(join(runDir, 'journal.jsonl'), 'utf8');
    assert.match(events, /"type":"phase","title":"Scan"/);
    assert.match(events, /"type":"log","phase":"Scan","message":"started"/);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('budget stops new agent calls after the output-token target', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  let calls = 0;
  try {
    const script = '/* autocode {"name":"budget","description":"Cap agents"} */\nawait agent("first"); try { await agent("second") } catch (e) { return {error:e.message,remaining:budget.remaining()} }';
    const output = await runWorkflow({ script, runDir, budget: 4, agent: async () => {
      calls++;
      return { result: 'done', outputTokens: 4 };
    } });
    assert.deepEqual(output.result, { error: 'Autocode token budget exceeded', remaining: 0 });
    assert.equal(calls, 1);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('resume reuses the unchanged agent prefix and reruns from the edited call', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  const meta = '/* autocode {"name":"resume","description":"Resume completed work"} */\n';
  const firstScript = `${meta}return [await agent("first"), await agent("second")];`;
  let calls = [];
  const adapter = async (prompt) => {
    calls.push(prompt);
    return { result: prompt.toUpperCase(), outputTokens: 1 };
  };
  try {
    const first = await runWorkflow({ script: firstScript, runDir, agent: adapter });
    assert.deepEqual(first.result, ['FIRST', 'SECOND']);
    assert.deepEqual(calls, ['first', 'second']);
    calls = [];
    const resumed = await runWorkflow({ script: firstScript, runDir, resumeFromRunId: first.runId, agent: adapter });
    assert.deepEqual(resumed.result, ['FIRST', 'SECOND']);
    assert.deepEqual(calls, []);
    assert.equal(resumed.runId, first.runId);
    calls = [];
    const edited = await runWorkflow({ script: `${meta}return [await agent("first"), await agent("changed")];`,
      runDir, resumeFromRunId: first.runId, agent: adapter });
    assert.deepEqual(edited.result, ['FIRST', 'CHANGED']);
    assert.deepEqual(calls, ['changed']);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('resume matches parallel branches despite different completion order', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  const script = '/* autocode {"name":"branches","description":"Resume parallel branches"} */\nreturn await parallel([()=>agent("slow").then(x=>agent(x)),()=>agent("fast").then(x=>agent(x))]);';
  let calls = [];
  const adapter = async (prompt) => {
    calls.push(prompt);
    await new Promise((resolve) => setTimeout(resolve, prompt === 'slow' ? 10 : 1));
    return { result: `${prompt}!`, outputTokens: 1 };
  };
  try {
    const first = await runWorkflow({ script, runDir, agent: adapter });
    assert.deepEqual(first.result, ['slow!!', 'fast!!']);
    calls = [];
    const resumed = await runWorkflow({ script, runDir, resumeFromRunId: first.runId, agent: adapter });
    assert.deepEqual(resumed.result, first.result);
    assert.deepEqual(calls, []);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('workflow cannot reach Node process through exposed values', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  try {
    const script = '/* autocode {"name":"escape","description":"Check isolation"} */\nlet escaped;try{escaped=typeof args.constructor.constructor("return process")()}catch(e){escaped=e.name}let fnEscape;try{fnEscape=agent.constructor("return process")()}catch(e){fnEscape=e.name}return [typeof process,typeof require,typeof globalThis.process,fnEscape,escaped];';
    const result = await runWorkflow({ script, args: {}, runDir, agent: async () => { throw Error('unused'); } });
    assert.deepEqual(result.result, ['undefined', 'undefined', 'undefined', 'EvalError', 'EvalError']);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('agent results and progress API do not expose host constructors', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  try {
    const script = '/* autocode {"name":"result-isolation","description":"Check returned values"} */\nconst pending=agent("data");let promiseEscape;try{promiseEscape=pending.constructor.constructor("return process.platform")()}catch(e){promiseEscape=e.name}const x=await pending;let escaped;try{escaped=x.constructor.constructor("return process.platform")()}catch(e){escaped=e.name}return [promiseEscape,escaped,typeof budget.constructor];';
    const result = await runWorkflow({ script, runDir,
      agent: async () => ({ result: { value: 1 }, outputTokens: 1 }) });
    assert.deepEqual(result.result, ['EvalError', 'EvalError', 'undefined']);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('named child workflow shares the runner budget and returns its result', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
  const script = '/* autocode {"name":"parent","description":"Call child"} */\nreturn [await workflow("child",{question:"one"}),budget.spent()];';
  const child = '/* autocode {"name":"child","description":"Ask question"} */\nreturn await agent(args.question);';
  try {
    const result = await runWorkflow({ script, runDir, budget: 5,
      resolveWorkflow: async (name) => { assert.equal(name, 'child'); return child; },
      agent: async (prompt) => ({ result: `answer:${prompt}`, outputTokens: 2 }) });
    assert.deepEqual(result.result, ['answer:one', 2]);
    assert.equal(result.agentCount, 1);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('nondeterministic clocks and randomness cannot silently corrupt replay', async () => {
  for (const expression of ['Date.now()', 'Math.random()', 'new Date()']) {
    const runDir = await mkdtemp(join(tmpdir(), 'autocode-test-'));
    try {
      const script = `/* autocode {"name":"determinism","description":"Check replay"} */\nreturn ${expression};`;
      await assert.rejects(runWorkflow({ script, runDir, agent: async () => { throw Error('unused'); } }),
        /unavailable in Autocode workflows/);
    } finally { await rm(runDir, { recursive: true, force: true }); }
  }
});
