import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runWorkflow } from '../scripts/runtime.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('skill includes usable instructions and templates', async () => {
  const skill = await readFile(join(root, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: autocode\n/m);
  assert.doesNotMatch(skill, /\[TODO/);
  assert.match(skill, /scripts\/autocode\.mjs run/);
  for (const file of [
    'references/authoring.md',
    'assets/templates/review-and-verify.js', 'assets/templates/parallel-scout.js',
    'assets/templates/mixed-provider.js',
  ]) assert.ok((await stat(join(root, file))).size > 0, file);
});

test('bundled review template runs both review and verification stages', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-template-'));
  try {
    const script = await readFile(join(root, 'assets/templates/review-and-verify.js'), 'utf8');
    const prompts = [];
    const output = await runWorkflow({ script, args: { topics: ['src/a.js'] }, runDir,
      agent: async (prompt, opts) => {
        prompts.push(prompt);
        return { result: opts.schema ? { findings: ['possible bug'] } : 'confirmed', outputTokens: 1 };
      } });
    assert.deepEqual(output.result, [{ finding: 'possible bug', verdict: 'confirmed' }]);
    assert.equal(prompts.length, 2);
    assert.deepEqual(output.failures, []);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('bundled scout template preserves question-to-answer mapping', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-template-'));
  try {
    const script = await readFile(join(root, 'assets/templates/parallel-scout.js'), 'utf8');
    const output = await runWorkflow({ script, args: { questions: ['first', 'second'] }, runDir,
      agent: async prompt => ({ result: `${prompt}!`, outputTokens: 1 }) });
    assert.deepEqual(output.result, [
      { question: 'first', finding: 'first!' },
      { question: 'second', finding: 'second!' },
    ]);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('mixed-provider template forwards each task model and provider', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-template-'));
  try {
    const script = await readFile(join(root, 'assets/templates/mixed-provider.js'), 'utf8');
    const seen = [];
    const output = await runWorkflow({ script, args: { tasks: [
      { question: 'one', provider: 'codex', model: 'small-codex', effort: 'low' },
      { question: 'two', provider: 'claude', model: 'haiku', effort: 'low' },
    ] }, runDir, agent: async (prompt, opts) => {
      seen.push([prompt, opts.provider, opts.model, opts.effort]);
      return { result: `${prompt}!`, outputTokens: 1 };
    } });
    assert.deepEqual(output.result, [
      { label: 'one', result: 'one!' }, { label: 'two', result: 'two!' },
    ]);
    assert.deepEqual(seen.sort(), [
      ['one', 'codex', 'small-codex', 'low'], ['two', 'claude', 'haiku', 'low'],
    ]);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});
