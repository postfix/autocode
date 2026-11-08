import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { ompAgent } from '../scripts/omp-adapter.mjs';

function fakeChild(onCommand) {
  const child = new EventEmitter();
  child.stdin = new Writable({
    write(chunk, _enc, cb) {
      for (const line of chunk.toString().split('\n')) {
        if (!line) continue;
        let cmd;
        try { cmd = JSON.parse(line); } catch { continue; }
        onCommand(cmd, child);
      }
      cb();
    },
  });
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (signal) => {
    child.signalCode = signal;
    child.exitCode = null;
    child.stdout.end();
    child.emit('exit', 0, signal);
  };
  return child;
}

const frame = (obj) => child => child.stdout.write(`${JSON.stringify(obj)}\n`);

function replyText(cmd, child, text) {
  frame({ type: 'message_start', message: { role: 'assistant' } })(child);
  frame({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } })(child);
  frame({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }] } })(child);
  frame({ type: 'prompt_result', id: cmd.id, agentInvoked: true, status: 'completed', sessionSettled: true })(child);
}

function replyStats(cmd, child, tokens = { input: 10, output: 7, cacheRead: 3 }) {
  frame({ id: cmd.id, type: 'response', command: 'get_session_stats', success: true, data: { tokens } })(child);
}

function emitChunked(child, obj, chunkBytes = 8) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const count = Math.max(1, Math.ceil(json.length / chunkBytes));
  for (let i = 0; i < count; i += 1) {
    const seg = json.subarray(i * chunkBytes, Math.min((i + 1) * chunkBytes, json.length));
    child.stdout.write(`${JSON.stringify({ type: 'rpc_chunk', chunkId: 'c1', index: i, count, byteLength: json.length, data: seg.toString('base64') })}\n`);
  }
}

const spawnWith = (onCommand) => () => fakeChild(onCommand);

test('OMP RPC adapter returns text and token usage', async () => {
  const usage = [];
  const output = await ompAgent('Inspect', {}, {
    runDir: '/tmp', cwd: '/tmp',
    spawn: spawnWith((cmd, child) => {
      if (cmd.type === 'prompt') replyText(cmd, child, 'done');
      else if (cmd.type === 'get_session_stats') replyStats(cmd, child);
    }),
    onUsage: u => usage.push(u),
  });
  assert.deepEqual(output, { result: 'done', outputTokens: 7 });
  assert.equal(usage.at(-1).outputTokens, 7);
  assert.equal(usage.at(-1).inputTokens, 10);
  assert.equal(usage.at(-1).cachedInputTokens, 3);
});

test('OMP RPC adapter reports tool activity events', async () => {
  const activity = [];
  const output = await ompAgent('Inspect', {}, {
    runDir: '/tmp', cwd: '/tmp',
    spawn: spawnWith((cmd, child) => {
      if (cmd.type === 'prompt') {
        frame({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'read' })(child);
        frame({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'read', isError: false })(child);
        replyText(cmd, child, 'read it');
      } else if (cmd.type === 'get_session_stats') replyStats(cmd, child, { input: 1, output: 1 });
    }),
    onActivity: a => activity.push(a),
  });
  assert.deepEqual(activity, [
    { id: 't1', tool: 'read', status: 'running' },
    { id: 't1', tool: 'read', status: 'completed' },
  ]);
  assert.deepEqual(output, { result: 'read it', outputTokens: 1 });
});

test('OMP RPC adapter parses structured output and repairs an invalid first reply', async () => {
  const schema = { type: 'object', properties: { answer: { type: 'integer' } }, required: ['answer'] };
  let prompts = 0;
  const output = await ompAgent('Answer', { schema }, {
    runDir: '/tmp', cwd: '/tmp',
    spawn: spawnWith((cmd, child) => {
      if (cmd.type === 'prompt') {
        prompts += 1;
        replyText(cmd, child, prompts === 1 ? '[]' : '{"answer":42}');
      } else if (cmd.type === 'get_session_stats') replyStats(cmd, child, { input: 3, output: 2 });
    }),
  });
  assert.equal(prompts, 2);
  assert.deepEqual(output, { result: { answer: 42 }, outputTokens: 2 });
});

test('OMP RPC adapter maps prompt_result errors to a retryable kind', async () => {
  await assert.rejects(ompAgent('Inspect', {}, {
    runDir: '/tmp', cwd: '/tmp',
    spawn: spawnWith((cmd, child) => {
      if (cmd.type === 'prompt') {
        frame({ type: 'prompt_result', id: cmd.id, agentInvoked: true, status: 'error', error: { message: 'overloaded', retryable: true }, sessionSettled: true })(child);
      } else if (cmd.type === 'get_session_stats') replyStats(cmd, child);
    }),
  }), err => err.kind === 'transient-api' && /overloaded/.test(err.message));
});

test('OMP RPC adapter completes local-only prompts without hanging', async () => {
  const output = await ompAgent('Inspect', {}, {
    runDir: '/tmp', cwd: '/tmp',
    spawn: spawnWith((cmd, child) => {
      if (cmd.type === 'prompt') {
        frame({ id: cmd.id, type: 'response', command: 'prompt', success: true, data: { agentInvoked: false } })(child);
      } else if (cmd.type === 'get_session_stats') replyStats(cmd, child, { input: 0, output: 0 });
    }),
  });
  assert.deepEqual(output, { result: '', outputTokens: 0 });
});

test('OMP RPC adapter rejects unsupported restrictions before spawning', async () => {
  const noSpawn = () => { throw new Error('should not spawn'); };
  await assert.rejects(ompAgent('x', { agentType: 'reviewer' }, { runDir: '/tmp', spawn: noSpawn }), /agentType/);
  await assert.rejects(ompAgent('x', { isolation: 'worktree' }, { runDir: '/tmp', spawn: noSpawn }), /worktree/);
  await assert.rejects(ompAgent('x', { disallowedTools: ['Bash'] }, { runDir: '/tmp', spawn: noSpawn }), /disallowedTools/);
  await assert.rejects(ompAgent('x', { bashCommandClamp: ['read-only'] }, { runDir: '/tmp', spawn: noSpawn }), /bashCommandClamp/);
  await assert.rejects(ompAgent('x', { effort: 'invalid' }, { runDir: '/tmp', spawn: noSpawn }), /unsupported effort/);
  await assert.rejects(ompAgent('x', { sandbox: 'full-write' }, { runDir: '/tmp', spawn: noSpawn }), /unsupported sandbox mode/);
});

test('OMP RPC adapter passes cwd, model, effort and read-only tools to the binary', async () => {
  const spawnCalls = [];
  const child = fakeChild((cmd, child) => {
    if (cmd.type === 'prompt') replyText(cmd, child, 'ok');
    else if (cmd.type === 'get_session_stats') replyStats(cmd, child, { input: 0, output: 1 });
  });
  await ompAgent('Inspect', { model: 'gpt-5.2', effort: 'high', sandbox: 'read-only' }, {
    runDir: '/tmp', cwd: '/proj', executable: '/bin/omp',
    spawn: (bin, args) => { spawnCalls.push({ bin, args }); return child; },
  });
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].bin, '/bin/omp');
  assert.ok(spawnCalls[0].args.includes('--cwd'));
  assert.ok(spawnCalls[0].args.includes('/proj'));
  assert.ok(spawnCalls[0].args.includes('--model'));
  assert.ok(spawnCalls[0].args.includes('gpt-5.2'));
  assert.ok(spawnCalls[0].args.includes('--thinking'));
  assert.ok(spawnCalls[0].args.includes('high'));
  assert.ok(spawnCalls[0].args.includes('--tools'));
  assert.ok(spawnCalls[0].args.includes('read,grep,glob'));
});

test('OMP RPC adapter passes --yolo for workspace-write and no read-only tool filter', async () => {
  const spawnCalls = [];
  const child = fakeChild((cmd, child) => {
    if (cmd.type === 'prompt') replyText(cmd, child, 'ok');
    else if (cmd.type === 'get_session_stats') replyStats(cmd, child, { input: 0, output: 1 });
  });
  await ompAgent('Inspect', { sandbox: 'workspace-write' }, {
    runDir: '/tmp', cwd: '/proj',
    spawn: (bin, args) => { spawnCalls.push(args); return child; },
  });
  assert.ok(spawnCalls[0].includes('--yolo'));
  assert.ok(!spawnCalls[0].includes('--tools'));
});

test('OMP RPC adapter negotiates v2 and reassembles chunked oversized frames', async () => {
  const big = 'x'.repeat(500);
  const commands = [];
  const output = await ompAgent('Inspect', {}, {
    runDir: '/tmp', cwd: '/tmp',
    spawn: spawnWith((cmd, child) => {
      commands.push(cmd.type);
      if (cmd.type === 'negotiate_protocol') {
        frame({ type: 'ready', protocolVersion: 1, supportedProtocolVersions: [1, 2], maxReassembledFrameBytes: 1048576 })(child);
      } else if (cmd.type === 'prompt') {
        frame({ type: 'message_start', message: { role: 'assistant' } })(child);
        emitChunked(child, { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: big }] } });
        frame({ type: 'prompt_result', id: cmd.id, agentInvoked: true, status: 'completed', sessionSettled: true })(child);
      } else if (cmd.type === 'get_session_stats') replyStats(cmd, child, { input: 1, output: 2 });
    }),
  });
  assert.equal(commands[0], 'negotiate_protocol');
  assert.deepEqual(output, { result: big, outputTokens: 2 });
});
