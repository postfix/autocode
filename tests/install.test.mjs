import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readlinkSync, lstatSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInstall } from '../scripts/install.mjs';

const CHECKOUT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'autocode-install-'));
  const previous = process.env.AUTOCODE_HOME;
  process.env.AUTOCODE_HOME = home;
  try {
    return await fn(home);
  } finally {
    if (previous === undefined) delete process.env.AUTOCODE_HOME;
    else process.env.AUTOCODE_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
}

function isLinkTo(link, target) {
  assert.ok(existsSync(link), `expected link to exist: ${link}`);
  assert.ok(lstatSync(link).isSymbolicLink(), `expected symlink: ${link}`);
  assert.equal(readlinkSync(link), target);
}

test('install --target omp links the CLI and the OMP skill', () => withHome(async (home) => {
  const out = await runInstall(['--target', 'omp']);
  assert.deepEqual(out.targets, ['omp']);
  isLinkTo(join(home, '.local', 'bin', 'autocode'), join(CHECKOUT, 'scripts', 'autocode.mjs'));
  isLinkTo(join(home, '.omp', 'agent', 'skills', 'autocode'), join(CHECKOUT, 'skills', 'autocode'));
}));

test('install --target all links codex, claude, and omp skills', () => withHome(async (home) => {
  const out = await runInstall(['--target', 'all']);
  assert.deepEqual(out.targets, ['codex', 'claude', 'omp']);
  isLinkTo(join(home, '.codex', 'skills', 'autocode'), CHECKOUT);
  isLinkTo(join(home, '.claude', 'skills', 'autocode'), CHECKOUT);
  isLinkTo(join(home, '.omp', 'agent', 'skills', 'autocode'), join(CHECKOUT, 'skills', 'autocode'));
}));

test('install --target accepts a comma list and skips unselected hosts', () => withHome(async (home) => {
  const out = await runInstall(['--target', 'codex,omp']);
  assert.deepEqual(out.targets, ['codex', 'omp']);
  isLinkTo(join(home, '.codex', 'skills', 'autocode'), CHECKOUT);
  isLinkTo(join(home, '.omp', 'agent', 'skills', 'autocode'), join(CHECKOUT, 'skills', 'autocode'));
  assert.equal(existsSync(join(home, '.claude', 'skills', 'autocode')), false);
}));

test('install rejects unknown targets', () => withHome(async () => {
  await assert.rejects(runInstall(['--target', 'nope']), /unknown target/);
}));

test('install requires --target when non-interactive', () => withHome(async () => {
  await assert.rejects(runInstall([]), /specify --target/);
}));

test('install --status reports current state and up-to-date links', () => withHome(async () => {
  await runInstall(['--target', 'omp']);
  const out = await runInstall(['--status']);
  const byName = Object.fromEntries(out.status.map(s => [s.name, s]));
  assert.equal(byName.omp.upToDate, true);
  assert.equal(byName.omp.current, join(CHECKOUT, 'skills', 'autocode'));
  assert.equal(byName.cli.upToDate, true);
}));

test('re-running install reports unchanged; a stale link is upgraded', () => withHome(async (home) => {
  const ompSkills = join(home, '.omp', 'agent', 'skills');
  mkdirSync(ompSkills, { recursive: true });
  const stale = join(home, 'old-checkout', 'skills', 'autocode');
  mkdirSync(stale, { recursive: true });
  symlinkSync(stale, join(ompSkills, 'autocode'), 'dir');

  const out = await runInstall(['--target', 'omp']);
  assert.equal(out.results.omp.action, 'upgraded');
  assert.equal(out.results.omp.previous, stale);

  const again = await runInstall(['--target', 'omp']);
  assert.equal(again.results.omp.action, 'unchanged');
}));

test('install refuses a real directory without --force and replaces it with --force', () => withHome(async (home) => {
  const ompSkill = join(home, '.omp', 'agent', 'skills', 'autocode');
  mkdirSync(ompSkill, { recursive: true });
  writeFileSync(join(ompSkill, 'SKILL.md'), 'old');

  const refused = await runInstall(['--target', 'omp']);
  assert.match(refused.results.omp.error, /real directory/);

  const out = await runInstall(['--target', 'omp', '--force']);
  assert.equal(out.results.omp.action, 'upgraded');
  assert.equal(readlinkSync(ompSkill), join(CHECKOUT, 'skills', 'autocode'));
}));
