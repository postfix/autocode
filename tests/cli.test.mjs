import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAutocode } from '../scripts/autocode.mjs';

const command = fileURLToPath(new URL('../scripts/autocode.mjs', import.meta.url));

test('run executes saved and scriptPath children with the Codex SDK adapter', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'autocode-cli-'));
  const script = join(dir, 'workflow.js');
  const runDir = join(dir, 'run');
  await mkdir(join(dir, '.codex', 'workflows'), { recursive: true });
  await writeFile(join(dir, '.codex', 'workflows', 'greet.js'),
    'export const meta = {name:"greet",description:"Greet"};\nreturn await agent(`Hello ${args.name}`);');
  await writeFile(join(dir, 'by-path.js'),
    'export const meta = {name:"by-path",description:"Read args"};\nreturn args.name;');
  await writeFile(script, 'export const meta = {name:"cli",description:"Exercise command"};\nreturn [await workflow("greet",args),await workflow({scriptPath:"by-path.js"},args)];');
  try {
    const output = await runAutocode(['run', script, '--args', '{"name":"Codex"}',
      '--run-dir', runDir, '--cwd', dir], {
      codex: async (prompt, opts) => {
        assert.equal(prompt, 'Hello Codex');
        assert.equal(opts.sandbox, 'read-only');
        return { result: 'reply', outputTokens: 3 };
      },
    });
    assert.deepEqual(output.result, ['reply', 'Codex']);
    assert.equal(output.outputTokens, 3);
    assert.match(await readFile(join(runDir, 'journal.jsonl'), 'utf8'), /"result":"reply"/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('run selects Claude as the default SDK provider', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'autocode-cli-'));
  const script = join(dir, 'workflow.js');
  await writeFile(script, 'export const meta = {name:"claude",description:"Select provider"};\nreturn await agent("check");');
  try {
    const output = await runAutocode(['run', script, '--provider', 'claude',
      '--run-dir', join(dir, 'run'), '--cwd', dir], {
      claude: async (prompt) => {
        assert.equal(prompt, 'check');
        return { result: 'CLAUDE_OK', outputTokens: 5 };
      },
    });
    assert.equal(output.result, 'CLAUDE_OK');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('one run can route calls to both SDKs with different models and effort', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'autocode-cli-'));
  const script = join(dir, 'workflow.js');
  await writeFile(script, 'export const meta = {name:"mixed",description:"Use both"};\nreturn await parallel([()=>agent("one",{provider:"codex",model:"small-codex",effort:"low"}),()=>agent("two",{provider:"claude",model:"haiku",effort:"low"})]);');
  try {
    const output = await runAutocode(['run', script, '--run-dir', join(dir, 'run'), '--cwd', dir], {
      codex: async (prompt, opts) => {
        assert.deepEqual([prompt, opts.model, opts.effort], ['one', 'small-codex', 'low']);
        return { result: 'CODEX_OK', outputTokens: 2 };
      },
      claude: async (prompt, opts) => {
        assert.deepEqual([prompt, opts.model, opts.effort], ['two', 'haiku', 'low']);
        return { result: 'CLAUDE_OK', outputTokens: 3 };
      },
    });
    assert.deepEqual(output.result, ['CODEX_OK', 'CLAUDE_OK']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('run rejects unknown providers and flags before invoking an SDK', async () => {
  await assert.rejects(runAutocode(['run', '/tmp/missing.js', '--provider', 'other']), /unknown provider/);
  await assert.rejects(runAutocode(['run', '/tmp/missing.js', '--unknown', 'x']), /unknown option/);
});

test('command prints a workflow result and reports usage errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'autocode-command-'));
  const script = join(dir, 'workflow.js');
  await writeFile(script, 'export const meta = {name:"simple",description:"Return a number"};\nreturn 5;');
  const invoke = (args) => new Promise((done, reject) => {
    const child = spawn('/bin/sh', ['-c', '"$@" > "$OUT" 2> "$ERR"', 'sh', process.execPath, command, ...args],
      { stdio: 'ignore', env: { ...process.env, OUT: join(dir, 'out'), ERR: join(dir, 'err') } });
    child.on('error', reject);
    child.on('close', done);
  });
  try {
    assert.equal(await invoke(['run', script, '--run-dir', join(dir, 'run')]), 0);
    assert.equal(JSON.parse(await readFile(join(dir, 'out'), 'utf8')).result, 5);
    assert.equal(await invoke(['run', script, '--unknown', 'x']), 1);
    assert.match(await readFile(join(dir, 'err'), 'utf8'), /unknown option/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

