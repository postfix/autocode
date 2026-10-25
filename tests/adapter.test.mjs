import test from 'node:test';
import assert from 'node:assert/strict';
import { codexAgent } from '../scripts/codex-adapter.mjs';

const context = (turn) => ({ runDir: '/tmp', cwd: '/tmp', Codex: class {
  startThread() { return { run: turn }; }
} });

test('Codex SDK adapter returns text and token usage', async () => {
  const output = await codexAgent('Inspect', {}, context(async () => ({
    finalResponse: 'done\n', usage: { output_tokens: 7 },
  })));
  assert.deepEqual(output, { result: 'done', outputTokens: 7 });
});

test('Codex SDK adapter parses structured output and rejects invalid objects', async () => {
  const schema = { type: 'object', properties: { answer: { type: 'integer' } }, required: ['answer'] };
  assert.deepEqual(await codexAgent('Answer', { schema }, context(async () => ({
    finalResponse: '{"answer":42}', usage: { output_tokens: 2 },
  }))), { result: { answer: 42 }, outputTokens: 2 });
  await assert.rejects(codexAgent('Answer', { schema }, context(async () => ({
    finalResponse: '[]', usage: null,
  }))), /non-object structured result/);
});

test('Codex SDK adapter rejects unsupported options before starting a thread', async () => {
  await assert.rejects(codexAgent('Inspect', { agentType: 'reviewer' }, context(async () => {})), /agentType/);
  await assert.rejects(codexAgent('Inspect', { isolation: 'worktree' }, context(async () => {})), /worktree/);
  await assert.rejects(codexAgent('Inspect', { effort: 'invalid' }, context(async () => {})), /unsupported effort/);
});

test('Codex SDK adapter propagates native turn failures', async () => {
  await assert.rejects(codexAgent('Inspect', {}, context(async () => { throw Error('SDK failure'); })), /SDK failure/);
});
