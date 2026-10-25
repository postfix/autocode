import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeAgent } from '../scripts/claude-adapter.mjs';

const context = (message) => ({ runDir: '/tmp', cwd: '/tmp', query: () =>
  (async function* () { yield message; })() });

test('Claude SDK adapter returns text and usage', async () => {
  const output = await claudeAgent('Inspect', {}, context({ type: 'result', subtype: 'success',
    result: 'CLAUDE_OK', usage: { output_tokens: 4 } }));
  assert.deepEqual(output, { result: 'CLAUDE_OK', outputTokens: 4 });
});

test('Claude SDK adapter permits authorized edits through file tools', async () => {
  let options;
  const query = ({ options: received }) => {
    options = received;
    return (async function* () { yield { type: 'result', subtype: 'success',
      result: 'done', usage: { output_tokens: 3 } }; })();
  };
  await claudeAgent('Edit', { sandbox: 'workspace-write' }, { query, runDir: '/tmp', cwd: '/tmp' });
  assert.equal(options.permissionMode, 'acceptEdits');
  assert.deepEqual(options.tools, ['Read', 'Grep', 'Glob', 'Edit', 'Write']);
  assert.equal(options.sandbox.enabled, true);
});

test('Claude SDK adapter reports failed results and rejects unsupported isolation', async () => {
  await assert.rejects(claudeAgent('Inspect', {}, context({
    type: 'result', subtype: 'error_during_execution', result: 'failed', is_error: true,
  })), /error_during_execution/);
  await assert.rejects(claudeAgent('Inspect', { isolation: 'worktree' }, context({})), /worktree/);
});
