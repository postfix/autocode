import { Codex } from '@openai/codex-sdk';
import { spawn } from 'node:child_process';
import {createHash} from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const model = 'gpt-6-luna', delegateEffort = 'medium';
async function executeCli(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, options); let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

export async function evaluateLiveSkill({ CodexClass = Codex, runCli = executeCli,
  timeoutMs = 180000, scratch = process.env.AUTOCODE_EVAL_SCRATCH ?? join(dirname(root), '.scratch', 'autocode-evals') } = {}) {
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('timeoutMs must be a positive integer');
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(Error(`Authoring smoke evaluation timed out after ${timeoutMs}ms`)), timeoutMs);
let project, thread;
try {
await mkdir(scratch, { recursive: true });
project = await mkdtemp(join(scratch, 'run-'));
const source = 'export function add(a, b) { return a - b; }\n';
await writeFile(join(project, 'math.js'), source);
await writeFile(join(project, 'package.json'), JSON.stringify({type:'module'}));
const skillPath=join(root,'SKILL.md'),skillSha256=createHash('sha256').update(await readFile(skillPath)).digest('hex');
const workflowFile = join(project, 'review.js');
const runDir = join(project, 'run');
const contextFile = join(project, 'host-context.json');
await writeFile(contextFile, JSON.stringify({id:'live-skill-eval',revision:'luna-v1',providers:{codex:{forcedModel:model,forcedEffort:delegateEffort}}}), {mode:0o600});
thread = new CodexClass().startThread({
  workingDirectory: project,
  sandboxMode: 'workspace-write',
  skipGitRepoCheck: true,
  approvalPolicy: 'never',
  modelReasoningEffort: 'high',
  model,
});
const prompt = `Author a JavaScript workflow in ${workflowFile} using the current checkout skill. Before authoring, read the actual file ${skillPath} using your file/command tools, then follow its required references. This evaluates that checkout, not an older installed skill or plugin autoload. Have two independent Codex reviewers using gpt-6-luna inspect math.js, then a skeptical Codex verifier check their findings. The function is named add; investigate whether it behaves as named. Use read-only delegated calls and report concrete evidence. The workflow must return {findings:[{file:"math.js",symbol:"add",reproduction:{args:[2,3],expected:number,actual:number}}]} with a hand-worked expected addition value and the actual function result, after skeptical verification. This is an authoring eval: save the workflow and stop. The evaluator will run it separately. Do not edit math.js.`;

  controller.signal.throwIfAborted();
  const host = await thread.run(prompt, {signal:controller.signal});
  controller.signal.throwIfAborted();
  const script = await readFile(workflowFile, 'utf8');
  const execution = await runCli([join(root, 'scripts/autocode.mjs'), 'run', workflowFile,
    '--provider', 'codex', '--cwd', project, '--run-dir', runDir, '--sandbox', 'read-only', '--context', contextFile], { cwd: project, signal:controller.signal });
  controller.signal.throwIfAborted();
  if (execution.code !== 0) throw Error(`workflow CLI exited ${execution.code}: ${execution.stderr}`);
  const output = JSON.parse(execution.stdout);
  const journal = (await readFile(join(runDir, 'journal.jsonl'), 'utf8'))
    .trim().split('\n').map(line => JSON.parse(line));
  const results = journal.filter(entry => entry.type === 'result');
  const sourceUnchanged = (await readFile(join(project, 'math.js'), 'utf8')) === source;
  const actual = sourceUnchanged ? (await import(pathToFileURL(join(resolve(project), 'math.js')).href)).add(2,3) : undefined, expected = 5;
  const witnessed = output.result?.findings?.some(finding => finding.file === 'math.js' && finding.symbol === 'add' &&
    JSON.stringify(finding.reproduction?.args) === '[2,3]' && finding.reproduction.expected === expected &&
    finding.reproduction.actual === actual && actual !== expected) ?? false;
  const started = journal.filter(event => event.type === 'started');
  const checks = {
    currentSkillRead:host.items?.some(item=>item.type==='command_execution'&&item.exit_code===0&&item.command?.includes(skillPath))??false,
    requiredModelSelection: started.length >= 3 && started.every(event => event.provider === 'codex' && event.model === model),
    skillAuthoredWorkflow: /export\s+const\s+meta/.test(script) && /parallel\(/.test(script) && /verif|refut/i.test(script),
    sdkAgentsCompleted: output.agentCount >= 3 && results.length >= 3 && output.failures.length === 0,
    bugVerified: witnessed,
    sourceUnchanged,
  };
  const report = { project, sourceSkill:{path:skillPath,sha256:skillSha256}, scope:'current-checkout authoring smoke with separate CLI execution', checks, models:{requestedParent:model,forcedDelegate:model,forcedDelegateEffort:delegateEffort,journalConfiguredModels:[...new Set(journal.filter(event=>event.type==='started').map(event=>event.model))],parentApiReportedModel:null,delegateApiReportedModels:null,verification:'Selection is explicit; journal model fields record configured choices, not independently API-reported models.'}, resultCount: results.length, runId: output.runId,
    authorResponse: host.finalResponse, passed: Object.values(checks).every(Boolean) };
  controller.signal.throwIfAborted();
  return report;
} catch (error) { return { project, scope:'current-checkout authoring smoke with separate CLI execution', models:{requestedParent:model,forcedDelegate:model,forcedDelegateEffort:delegateEffort,parentApiReportedModel:null,delegateApiReportedModels:null}, error:(controller.signal.aborted ? controller.signal.reason : error).message, passed:false }; }
finally { clearTimeout(timeout); await thread?.close?.(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await evaluateLiveSkill();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
