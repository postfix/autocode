#!/usr/bin/env node
import {
  existsSync, mkdirSync, symlinkSync, chmodSync,
  lstatSync, unlinkSync, rmSync, readlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';

const CHECKOUT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['codex', 'claude', 'omp'];
const homeDir = () => process.env.AUTOCODE_HOME || homedir();

const targetLayout = (target) => {
  const home = homeDir();
  if (target === 'codex') return { dir: join(home, '.codex', 'skills'), name: 'autocode', source: CHECKOUT };
  if (target === 'claude') return { dir: join(home, '.claude', 'skills'), name: 'autocode', source: CHECKOUT };
  if (target === 'omp') return { dir: join(home, '.omp', 'agent', 'skills'), name: 'autocode', source: join(CHECKOUT, 'skills', 'autocode') };
  throw new Error(`unknown target: ${target}`);
};

function cliEntry() {
  const script = join(CHECKOUT, 'scripts', 'autocode.mjs');
  return { link: join(homeDir(), '.local', 'bin', 'autocode'), source: script, type: 'file' };
}

function targetEntry(target) {
  const { dir, name, source } = targetLayout(target);
  return { link: join(dir, name), source, type: 'dir' };
}

function describePath(path) {
  let st;
  try { st = lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') return { kind: 'absent' };
    throw error;
  }
  if (st.isSymbolicLink()) return { kind: 'link', target: readlinkSync(path) };
  if (st.isDirectory()) return { kind: 'dir' };
  return { kind: 'file' };
}

function installEntry(entry, { force = false } = {}) {
  if (!existsSync(entry.source)) throw new Error(`missing source for ${entry.link}: ${entry.source}`);
  if (entry.type === 'file') chmodSync(entry.source, 0o755);
  mkdirSync(dirname(entry.link), { recursive: true });
  const previous = describePath(entry.link);
  if (previous.kind === 'dir' && !force) {
    throw new Error(`target is a real directory, not a symlink; move or remove it, or re-run with --force: ${entry.link}`);
  }
  if (previous.kind === 'dir') rmSync(entry.link, { recursive: true, force: true });
  else if (previous.kind !== 'absent') unlinkSync(entry.link);
  symlinkSync(entry.source, entry.link, entry.type);
  const action = previous.kind === 'absent' ? 'installed'
    : previous.kind === 'link' && previous.target === entry.source ? 'unchanged'
    : 'upgraded';
  return {
    path: entry.link,
    source: entry.source,
    previous: previous.kind === 'absent' ? null : (previous.target ?? previous.kind),
    action,
  };
}

function statusEntry(name, entry) {
  const current = describePath(entry.link);
  return {
    name,
    path: entry.link,
    source: entry.source,
    current: current.kind === 'absent' ? null : (current.target ?? current.kind),
    upToDate: current.kind === 'link' && current.target === entry.source,
  };
}

function status() {
  const entries = [
    { name: 'cli', entry: cliEntry() },
    ...TARGETS.map(target => ({ name: target, entry: targetEntry(target) })),
  ];
  return entries.map(({ name, entry }) => statusEntry(name, entry));
}

function parseTargets(flag) {
  if (!flag) return null;
  const selected = flag.split(',').map(s => s.trim()).filter(Boolean);
  if (selected.includes('all')) return [...TARGETS];
  const seen = new Set();
  for (const name of selected) {
    if (!TARGETS.includes(name)) throw new Error(`unknown target: ${name}`);
    seen.add(name);
  }
  return [...seen];
}

export async function runInstall(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target' && argv[i + 1]) flags.target = argv[++i];
    else if (argv[i] === '--yes' || argv[i] === '-y') flags.yes = true;
    else if (argv[i] === '--json') flags.json = true;
    else if (argv[i] === '--status') flags.status = true;
    else if (argv[i] === '--force') flags.force = true;
    else throw new Error(`unknown install option: ${argv[i]}`);
  }

  if (flags.status) return { status: status(), dependencies: existsSync(join(CHECKOUT, 'node_modules')) };

  let targets = parseTargets(flags.target);
  if (targets === null) {
    if (flags.yes || !process.stdin.isTTY) throw new Error('specify --target codex|claude|omp|all');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = (await rl.question('Install targets (codex, claude, omp, all) [all]: ')).trim().toLowerCase();
      targets = parseTargets(answer || 'all');
    } finally {
      rl.close();
    }
  }

  const results = {};
  try {
    results.cli = installEntry(cliEntry(), { force: flags.force });
  } catch (error) {
    results.cli = { error: error.message };
  }
  for (const target of targets) {
    try {
      results[target] = installEntry(targetEntry(target), { force: flags.force });
    } catch (error) {
      results[target] = { error: error.message };
    }
  }
  const output = { targets, results };
  if (!existsSync(join(CHECKOUT, 'node_modules'))) {
    output.warning = 'checkout dependencies are missing; run `npm ci` in the checkout before running workflows';
  }
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runInstall(process.argv.slice(2))
    .then(output => { process.stdout.write(`${JSON.stringify(output)}\n`); })
    .catch(error => { process.stderr.write(`autocode-install: ${error.message}\n`); process.exitCode = 1; });
}
