import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('npm tarball contains the executable skill without development files', async () => {
  const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
  assert.equal(manifest.name, 'autocode-skill');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.license, 'Apache-2.0');
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.bin?.autocode, 'scripts/autocode.mjs');
  const cache = await mkdtemp(join(tmpdir(), 'autocode-npm-cache-'));
  let output;
  try {
    const code = await new Promise((done, reject) => {
      const child = spawn('/bin/sh', ['-c', 'npm pack --dry-run --json > "$PACK_OUTPUT" 2> "$PACK_ERROR"'],
        { cwd: root, stdio: 'ignore', env: { ...process.env, npm_config_cache: cache,
          PACK_OUTPUT: join(cache, 'pack.json'), PACK_ERROR: join(cache, 'error.txt') } });
      child.on('error', reject);
      child.on('close', done);
    });
    assert.equal(code, 0, await readFile(join(cache, 'error.txt'), 'utf8'));
    output = await readFile(join(cache, 'pack.json'), 'utf8');
  } finally { await rm(cache, { recursive: true, force: true }); }
  const [{ files }] = JSON.parse(output);
  const paths = files.map(file => file.path);
  for (const path of ['SKILL.md', 'LICENSE', 'README.md', 'INSTALL.md', 'USAGE.md',
    'agents/openai.yaml', 'references/authoring.md', 'scripts/autocode.mjs',
    'scripts/codex-adapter.mjs', 'scripts/claude-adapter.mjs', 'scripts/runtime.mjs',
    'assets/templates/parallel-scout.js', 'assets/templates/review-and-verify.js',
    'assets/templates/mixed-provider.js']) assert.ok(paths.includes(path), path);
  assert.ok(paths.every(path => !path.startsWith('tests/') && !path.startsWith('.codex/') &&
    !path.startsWith('.github/') && !path.includes('recovered-code')));
});
