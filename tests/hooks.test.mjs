import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { hasUltracodeKeyword, transition, formatOutput } = require('../hooks/autocode-mode.cjs');

test('keyword scanner matches human prose and skips commands, quotes, and paths', () => {
  assert.equal(hasUltracodeKeyword('Use ULTRACODE to review this'), true);
  for (const prompt of ['/ultracode on', 'Read "ultracode"', '`ultracode`',
    'src/ultracode.js', 'ultracode?'])
    assert.equal(hasUltracodeKeyword(prompt), false, prompt);
});

test('mode emits full, sparse after ten human turns, and exit reminders', () => {
  let { state, message } = transition('UserPromptSubmit', { prompt: 'autocode on', source: 'user' });
  assert.match(message, /Autocode is on/);
  for (let turn = 1; turn < 10; turn++) {
    ({ state, message } = transition('UserPromptSubmit', { prompt: `Task ${turn}`, source: 'user' }, state));
    assert.equal(message, '');
  }
  ({ state, message } = transition('UserPromptSubmit', { prompt: 'Task 10', source: 'user' }, state));
  assert.match(message, /still on/);
  assert.equal(state.turns, 0);
  ({ state, message } = transition('UserPromptSubmit', { prompt: 'autocode off', source: 'user' }, state));
  assert.match(message, /is off/);
  assert.equal(state.on, false);
});

test('keyword is one-turn opt-in; resume preserves mode; startup clears it', () => {
  const keyword = transition('UserPromptSubmit', { prompt: 'Please ultracode this', source: 'user' });
  assert.match(keyword.message, /opting this turn/);
  assert.equal(keyword.state.on, false);
  const active = transition('UserPromptSubmit', { prompt: 'ultracode on', source: 'user' }).state;
  assert.match(transition('SessionStart', { source: 'compact' }, active).message, /still on/);
  assert.equal(transition('SessionStart', { source: 'startup' }, active).state.on, false);
  assert.equal(transition('UserPromptSubmit', { prompt: 'ultracode', source: 'sdk' }, active).message, '');
});

test('replayed prompt ID does not count a turn twice', () => {
  const first = transition('UserPromptSubmit', { prompt: 'autocode on', prompt_id: 'one' });
  const replay = transition('UserPromptSubmit', { prompt: 'autocode on', prompt_id: 'one' }, first.state);
  assert.deepEqual(replay, first);
  const next = transition('UserPromptSubmit', { prompt: 'Work', prompt_id: 'two' }, first.state);
  assert.equal(next.state.turns, 1);
});

test('Codex and Claude hook commands emit their host-specific context', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'hooks/claude-codex-hooks.json'), 'utf8'));
  for (const event of ['SessionStart', 'UserPromptSubmit'])
    assert.match(manifest.hooks[event][0].hooks[0].command, /autocode-mode\.cjs/);
  const message = transition('UserPromptSubmit', { prompt: 'autocode on' }).message;
  assert.match(formatOutput('UserPromptSubmit', message, true).hookSpecificOutput.additionalContext,
    /Autocode is on/);
  assert.match(formatOutput('UserPromptSubmit', message, false), /Autocode is on/);
});
