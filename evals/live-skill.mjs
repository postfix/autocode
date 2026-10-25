import { Codex } from '@openai/codex-sdk';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = process.env.AUTOCODE_EVAL_SCRATCH ?? join(dirname(root), '.scratch', 'autocode-evals');
await mkdir(scratch, { recursive: true });
const project = await mkdtemp(join(scratch, 'run-'));
const source = 'export function add(a, b) { return a - b; }\n';
await writeFile(join(project, 'math.js'), source);
const workflowFile = join(project, 'review.js');
const runDir = join(project, 'run');
const thread = new Codex().startThread({
  workingDirectory: project,
  sandboxMode: 'workspace-write',
  skipGitRepoCheck: true,
  approvalPolicy: 'never',
  modelReasoningEffort: 'high',
});
const prompt = `$autocode Author a JavaScript workflow in ${workflowFile} using the installed skill. Have two independent Codex reviewers inspect math.js, then a skeptical Codex verifier check their findings. The function is named add; investigate whether it behaves as named. Use read-only delegated calls and report concrete evidence. This is an authoring eval: save the workflow and stop. The evaluator will run it separately. Do not edit math.js.`;

try {
  const host = await thread.run(prompt);
  const script = await readFile(workflowFile, 'utf8');
  const execution = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'scripts/autocode.mjs'), 'run',
      workflowFile, '--provider', 'codex', '--cwd', project, '--run-dir', runDir,
      '--sandbox', 'read-only'], { cwd: project });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
  if (execution.code !== 0) throw Error(`workflow CLI exited ${execution.code}: ${execution.stderr}`);
  const output = JSON.parse(execution.stdout);
  const journal = (await readFile(join(runDir, 'journal.jsonl'), 'utf8'))
    .trim().split('\n').map(line => JSON.parse(line));
  const results = journal.filter(entry => entry.type === 'result');
  const evidence = JSON.stringify(output.result);
  const checks = {
    skillAuthoredWorkflow: /export\s+const\s+meta/.test(script) && /parallel\(/.test(script) && /verif|refut/i.test(script),
    sdkAgentsCompleted: output.agentCount >= 3 && results.length >= 3 && output.failures.length === 0,
    bugVerified: /subtract|subtraction|a\s*-\s*b|minus/i.test(evidence),
    sourceUnchanged: (await readFile(join(project, 'math.js'), 'utf8')) === source,
  };
  const report = { project, checks, resultCount: results.length, runId: output.runId,
    authorResponse: host.finalResponse, passed: Object.values(checks).every(Boolean) };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`Live skill eval failed in ${project}: ${error.stack ?? error}\n`);
  process.exitCode = 1;
}
