import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkflow } from '../scripts/runtime.mjs';

test('parallel and pipeline preserve every generated input in order', async () => {
  await fc.assert(fc.asyncProperty(
    fc.array(fc.integer({ min: -100, max: 100 }), { maxLength: 16 }),
    async (values) => {
      const runDir = await mkdtemp(join(tmpdir(), 'autocode-property-'));
      try {
        const script = '/* autocode {"name":"ordering","description":"Preserve item order"} */\nreturn [await parallel(args.map((x,i)=>async()=>{await new Promise(r=>setTimeout(r,(args.length-i)%4));return x})),await pipeline(args,async x=>{await new Promise(r=>setTimeout(r,Math.abs(x)%4));return x})];';
        const output = await runWorkflow({ script, args: values, runDir,
          agent: async () => { throw Error('unused'); } });
        assert.deepEqual(output.result, [values, values]);
      } finally { await rm(runDir, { recursive: true, force: true }); }
    }), { numRuns: 40, seed: 20417 });
});

test('resuming generated parallel calls reuses all completed results', async () => {
  await fc.assert(fc.asyncProperty(
    fc.uniqueArray(fc.stringMatching(/^[a-z]{1,8}$/), { maxLength: 10 }),
    async (prompts) => {
      const runDir = await mkdtemp(join(tmpdir(), 'autocode-property-'));
      try {
        const script = '/* autocode {"name":"resume","description":"Replay generated tasks"} */\nreturn await parallel(args.map(prompt=>()=>agent(prompt)));';
        const first = await runWorkflow({ script, args: prompts, runDir,
          agent: async (prompt) => ({ result: prompt, outputTokens: 1 }) });
        const resumed = await runWorkflow({ script, args: prompts, runDir,
          resumeFromRunId: first.runId, agent: async () => { throw Error('cached call ran again'); } });
        assert.deepEqual(first.result, prompts);
        assert.deepEqual(resumed.result, prompts);
        assert.equal(resumed.outputTokens, 0);
      } finally { await rm(runDir, { recursive: true, force: true }); }
    }), { numRuns: 40, seed: 20418 });
});

test('a generated token budget stops sequential agent launches at its ceiling', async () => {
  await fc.assert(fc.asyncProperty(
    fc.integer({ min: 0, max: 12 }), fc.integer({ min: 0, max: 20 }),
    fc.integer({ min: 1, max: 5 }), async (count, budget, cost) => {
      const runDir = await mkdtemp(join(tmpdir(), 'autocode-property-'));
      let launched = 0;
      try {
        const script = '/* autocode {"name":"budget","description":"Bound launches"} */\nfor(let i=0;i<args;i++){try{await agent(`task ${i}`)}catch{break}}return budget.spent();';
        const output = await runWorkflow({ script, args: count, budget, runDir,
          agent: async () => { launched++; return { result: 'done', outputTokens: cost }; } });
        assert.equal(launched, Math.min(count, Math.ceil(budget / cost)));
        assert.equal(output.result, launched * cost);
      } finally { await rm(runDir, { recursive: true, force: true }); }
    }), { numRuns: 60, seed: 20419 });
});
