import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRelease } from '../scripts/verify-release.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = { name: 'autocode-skill', version: '0.1.1' };
const lock = { name: 'autocode-skill', version: '0.1.1',
  packages: { '': { name: 'autocode-skill', version: '0.1.1' } } };
const paths = ['package.json', 'LICENSE', 'README.md', 'INSTALL.md', 'USAGE.md',
  'SKILL.md', 'agents/openai.yaml', 'references/authoring.md', 'references/quality-patterns.md',
  'assets/templates/parallel-scout.js', 'assets/templates/review-and-verify.js',
  'assets/templates/exhaustive-review.js', 'assets/templates/mixed-provider.js', 'scripts/autocode.mjs',
  'scripts/claude-adapter.mjs', 'scripts/codex-adapter.mjs', 'scripts/runtime.mjs'];
const pack = { name: 'autocode-skill', version: '0.1.1',
  files: paths.map(path => ({ path })) };

test('release accepts only the exact tagged, locked, allowlisted npm tarball', () => {
  assert.doesNotThrow(() => verifyRelease('v0.1.1', packageJson, lock, pack));
  assert.throws(() => verifyRelease('v0.1.2', packageJson, lock, pack), /tag/);
  assert.throws(() => verifyRelease('v0.1.1', packageJson,
    { ...lock, packages: { '': { ...lock.packages[''], version: '0.1.2' } } }, pack), /lockfile/);
  assert.throws(() => verifyRelease('v0.1.1', packageJson, lock,
    { ...pack, files: [...pack.files, { path: 'tests/secret.txt' }] }), /unexpected/);
  assert.throws(() => verifyRelease('v0.1.1', packageJson, lock,
    { ...pack, files: pack.files.filter(file => file.path !== 'SKILL.md') }), /missing/);
});

test('release verifier command checks manifest, lockfile, and pack report', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'autocode-release-'));
  await writeFile(join(dir, 'package.json'), JSON.stringify(packageJson));
  await writeFile(join(dir, 'package-lock.json'), JSON.stringify(lock));
  await writeFile(join(dir, 'pack.json'), JSON.stringify([pack]));
  try {
    const code = await new Promise((done, reject) => {
      const child = spawn('/bin/sh', ['-c', 'node "$CHECKER" v0.1.1 "$PACK" > "$OUT" 2> "$ERR"'],
        { cwd: dir, stdio: 'ignore', env: { ...process.env,
          CHECKER: join(root, 'scripts/verify-release.mjs'), PACK: join(dir, 'pack.json'),
          OUT: join(dir, 'out'), ERR: join(dir, 'err') } });
      child.on('error', reject);
      child.on('close', done);
    });
    assert.equal(code, 0, await readFile(join(dir, 'err'), 'utf8'));
    assert.match(await readFile(join(dir, 'out'), 'utf8'), /Verified autocode-skill@0\.1\.1/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
