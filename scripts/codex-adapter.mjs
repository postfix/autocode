import { Codex } from '@openai/codex-sdk';

const SUBAGENT_INSTRUCTIONS = 'You are a subagent spawned by an Autocode workflow. Your final response is the return value to the calling script. Complete only the assigned task within existing permissions. Return the requested result directly, without a status confirmation or Markdown fence. Follow the supplied output schema when present.';

export async function codexAgent(prompt, opts = {}, context = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('agent prompt must be non-empty');
  const { Codex: CodexClass = Codex, executable, cwd = process.cwd(), runDir, signal } = context;
  if (!runDir) throw new TypeError('runDir is required');
  if (opts.agentType !== undefined) throw new TypeError('agentType is unavailable in Codex Autocode');
  if (opts.isolation !== undefined) throw new TypeError('Codex SDK adapter does not support worktree isolation');
  const sandbox = opts.sandbox ?? 'read-only';
  if (!['read-only', 'workspace-write'].includes(sandbox)) throw new RangeError('unsupported sandbox mode');
  if (opts.effort !== undefined && !['low', 'medium', 'high', 'xhigh', 'max'].includes(opts.effort))
    throw new RangeError('unsupported effort');
  if (opts.schema && (opts.schema.type !== 'object' || !opts.schema.properties ||
      !Array.isArray(opts.schema.required ?? []))) throw new TypeError('schema must be a JSON object schema');
  const client = new CodexClass(executable ? { codexPathOverride: executable } : undefined);
  const thread = client.startThread({ workingDirectory: cwd, sandboxMode: sandbox,
    model: opts.model, modelReasoningEffort: opts.effort,
    skipGitRepoCheck: true, approvalPolicy: 'never' });
  const turn = await thread.run(`${SUBAGENT_INSTRUCTIONS}\n\nTask:\n${prompt}`,
    { outputSchema: opts.schema, signal });
  const result = opts.schema ? JSON.parse(turn.finalResponse) : turn.finalResponse.trimEnd();
  if (opts.schema && (typeof result !== 'object' || result === null || Array.isArray(result)))
    throw new TypeError('Codex returned a non-object structured result');
  const usage = turn.usage?.output_tokens ?? 0;
  return { result, outputTokens: Number.isSafeInteger(usage) && usage >= 0 ? usage : 0 };
}
