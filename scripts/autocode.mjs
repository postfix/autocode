#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkflow } from './runtime.mjs';
import { codexAgent } from './codex-adapter.mjs';
import { claudeAgent } from './claude-adapter.mjs';

export async function runAutocode(argv, adapters = { codex: codexAgent, claude: claudeAgent }) {
  if (argv[0] !== 'run' || !argv[1] || argv[1].startsWith('--'))
    throw new Error('usage: autocode run <script.js> [--provider codex|claude] [options]');
  const scriptPath = resolve(argv[1]);
  const flags = {};
  for (let i = 2; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] === undefined) throw new Error(`invalid option: ${argv[i]}`);
    flags[argv[i].slice(2)] = argv[i + 1];
  }
  for (const name of Object.keys(flags))
    if (!['args', 'run-dir', 'resume', 'budget', 'sandbox', 'codex', 'claude', 'provider', 'cwd'].includes(name))
      throw new Error(`unknown option: --${name}`);
  const provider = flags.provider ?? 'codex';
  if (!['codex', 'claude'].includes(provider)) throw new Error(`unknown provider: ${provider}`);
  const cwd = resolve(flags.cwd ?? process.cwd());
  const runDir = resolve(flags['run-dir'] ?? `.codex/autocode-runs/${flags.resume ?? randomUUID()}`);
  const args = flags.args === undefined ? undefined : JSON.parse(flags.args);
  const budget = flags.budget === undefined ? null : Number(flags.budget);
  const sandbox = flags.sandbox ?? 'read-only';
  const result = await runWorkflow({
    script: await readFile(scriptPath, 'utf8'), args, runDir, budget,
    resumeFromRunId: flags.resume,
    onProgress: (event) => process.stderr.write(event.type === 'phase' ?
      `${event.title}\n` : event.type === 'log' ? `${event.message}\n` :
      `${event.phase ? `[${event.phase}] ` : ''}${event.label}: ${event.type.slice(6)}\n`),
    resolveWorkflow: (reference) => readFile(typeof reference === 'string' ?
      join(cwd, '.codex', 'workflows', `${reference}.js`) : resolve(cwd, reference.scriptPath), 'utf8'),
    agent: (prompt, opts, context) => {
      const selected = opts.provider ?? provider;
      if (!['codex', 'claude'].includes(selected)) throw new Error(`unknown provider: ${selected}`);
      return adapters[selected](prompt, { ...opts, sandbox }, {
        ...context, cwd, executable: selected === 'codex' ? flags.codex : flags.claude,
      });
    },
  });
  return { ...result, runDir };
}

if (process.argv[1] && existsSync(process.argv[1]) &&
    realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  runAutocode(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    process.stderr.write(`autocode: ${error.message}\n`);
    process.exitCode = 1;
  });
