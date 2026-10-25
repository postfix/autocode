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
  assert.match(skill, /\nautocode run workflow\.js/);
  for (const file of [
    'references/authoring.md',
    'references/source-prompts/authoring.md',
    'references/quality-patterns.md',
    'assets/templates/review-and-verify.js', 'assets/templates/parallel-scout.js',
    'assets/templates/exhaustive-review.js', 'assets/templates/mixed-provider.js',
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
        return { result: prompt.startsWith('Review') ? { findings: ['possible bug'] } :
          { real: true, reason: 'reproduced' }, outputTokens: 1 };
      } });
    assert.deepEqual(output.result, [{ finding: 'possible bug', verdict: { real: true, reason: 'reproduced' } }]);
    assert.equal(prompts.length, 2);
    assert.deepEqual(output.failures, []);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('review template drops findings the verifier refutes', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-template-'));
  try {
    const script = await readFile(join(root, 'assets/templates/review-and-verify.js'), 'utf8');
    const output = await runWorkflow({ script, args: { topics: ['src/a.js'] }, runDir,
      agent: async prompt => ({ result: prompt.startsWith('Review') ?
        { findings: ['false alarm'] } : { real: false, reason: 'no repro' }, outputTokens: 1 }) });
    assert.deepEqual(output.result, []);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('exhaustive review deduplicates, votes, and stops after dry rounds', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-template-'));
  try {
    const script = await readFile(join(root, 'assets/templates/exhaustive-review.js'), 'utf8');
    const seen = [];
    const output = await runWorkflow({ script, args: { topics: ['src/a.js'], maxRounds: 4 }, runDir,
      agent: async prompt => {
        seen.push(prompt);
        if (prompt.startsWith('Round')) return { result: { findings: ['one issue'] }, outputTokens: 1 };
        if (prompt.startsWith('Try')) return { result: { real: true, reason: 'reproduced' }, outputTokens: 1 };
        return { result: 'No gaps found', outputTokens: 1 };
      } });
    assert.deepEqual(output.result.confirmed, ['one issue']);
    assert.equal(output.result.rounds, 3);
    assert.equal(output.result.stoppedAfterDryRounds, true);
    assert.equal(seen.filter(prompt => prompt.startsWith('Try')).length, 3);
    assert.deepEqual(output.failures, []);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test('exhaustive review does not confirm a finding without two positive votes', async () => {
  const runDir = await mkdtemp(join(tmpdir(), 'autocode-template-'));
  try {
    const script = await readFile(join(root, 'assets/templates/exhaustive-review.js'), 'utf8');
    const output = await runWorkflow({ script, args: { topics: ['src/a.js'], maxRounds: 1 }, runDir,
      agent: async prompt => ({ result: prompt.startsWith('Round') ? { findings: ['false alarm'] } :
        prompt.includes('correctness') ? { real: true, reason: 'possible' } :
          prompt.startsWith('Try') ? { real: false, reason: 'refuted' } : 'Check incomplete',
      outputTokens: 1 }) });
    assert.deepEqual(output.result.confirmed, []);
    assert.equal(output.result.stoppedAfterDryRounds, false);
    assert.match(output.logs.at(-1).message, /Stopped at maxRounds/);
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
