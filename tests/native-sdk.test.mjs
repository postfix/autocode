import test from 'node:test';
import assert from 'node:assert/strict';
import { codexAgent } from '../scripts/codex-adapter.mjs';
import { claudeAgent } from '../scripts/claude-adapter.mjs';

test('Codex adapter uses SDK thread options and turn result', async () => {
  const seen = {};
  class FakeCodex {
    constructor(options) { seen.client = options; }
    startThread(options) {
      seen.thread = options;
      return { run: async (prompt, options) => {
        seen.prompt = prompt; seen.turn = options;
        return { finalResponse: '{"answer":42}', usage: { output_tokens: 7 } };
      } };
    }
  }
  const schema = { type: 'object', properties: { answer: { type: 'integer' } }, required: ['answer'] };
  const output = await codexAgent('Answer', { model: 'small', effort: 'low', schema },
    { Codex: FakeCodex, cwd: '/tmp', runDir: '/tmp', executable: '/fake/codex' });
  assert.deepEqual(output, { result: { answer: 42 }, outputTokens: 7 });
  assert.equal(seen.client.codexPathOverride, '/fake/codex');
  assert.deepEqual(seen.thread, { workingDirectory: '/tmp', sandboxMode: 'read-only',
    model: 'small', modelReasoningEffort: 'low', skipGitRepoCheck: true, approvalPolicy: 'never' });
  assert.deepEqual(seen.turn.outputSchema, { ...schema, additionalProperties: false });
  assert.equal(schema.additionalProperties, undefined);
  assert.match(seen.prompt, /Answer$/);
});

test('Codex adapter strictens nested object schemas and rejects optional fields', async () => {
  let seen;
  class FakeCodex {
    startThread() { return { run: async (_prompt, options) => {
      seen = options.outputSchema;
      return { finalResponse: '{"detail":{"answer":42}}', usage: { output_tokens: 1 } };
    } }; }
  }
  const schema = { type: 'object', properties: { detail: { type: 'object',
    properties: { answer: { type: 'integer' } }, required: ['answer'] } }, required: ['detail'] };
  await codexAgent('Answer', { schema }, { Codex: FakeCodex, cwd: '/tmp', runDir: '/tmp' });
  assert.equal(seen.additionalProperties, false);
  assert.equal(seen.properties.detail.additionalProperties, false);
  await assert.rejects(codexAgent('Answer', { schema: { ...schema, required: [] } },
    { Codex: FakeCodex, cwd: '/tmp', runDir: '/tmp' }), /requires every property/);
});

test('Claude adapter consumes SDK query result and maps permissions', async () => {
  const seen = {};
  const query = ({ prompt, options }) => {
    seen.prompt = prompt; seen.options = options;
    return (async function* () {
      yield { type: 'assistant', message: { content: [] } };
      yield { type: 'result', subtype: 'success', result: 'done',
        structured_output: { answer: 42 }, usage: { output_tokens: 3 } };
    })();
  };
  const schema = { type: 'object', properties: { answer: { type: 'integer' } }, required: ['answer'] };
  const output = await claudeAgent('Answer', { model: 'haiku', effort: 'low', schema },
    { query, cwd: '/tmp', runDir: '/tmp', executable: '/fake/claude' });
  assert.deepEqual(output, { result: { answer: 42 }, outputTokens: 3 });
  assert.equal(seen.options.pathToClaudeCodeExecutable, '/fake/claude');
  assert.equal(seen.options.model, 'haiku');
  assert.equal(seen.options.effort, 'low');
  assert.equal(seen.options.permissionMode, 'dontAsk');
  assert.deepEqual(seen.options.tools, ['Read', 'Grep', 'Glob']);
  assert.deepEqual(seen.options.outputFormat, { type: 'json_schema', schema });
  assert.match(seen.prompt, /Answer$/);
});
