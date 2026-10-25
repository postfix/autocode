import { query } from '@anthropic-ai/claude-agent-sdk';

const SUBAGENT_INSTRUCTIONS = 'You are a subagent spawned by an Autocode workflow. Your final response is the return value to the calling script. Complete only the assigned task within existing permissions. Return the requested result directly, without a status confirmation or Markdown fence. Follow the supplied output schema when present.';

export async function claudeAgent(prompt, opts = {}, context = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('agent prompt must be non-empty');
  const { query: runQuery = query, executable, cwd = process.cwd(), runDir, signal } = context;
  if (!runDir) throw new TypeError('runDir is required');
  if (opts.agentType !== undefined) throw new TypeError('agentType is unavailable in cross-agent Autocode');
  if (opts.isolation !== undefined) throw new TypeError('Claude SDK adapter does not support worktree isolation');
  const sandbox = opts.sandbox ?? 'read-only';
  if (!['read-only', 'workspace-write'].includes(sandbox)) throw new RangeError('unsupported sandbox mode');
  if (opts.effort !== undefined && !['low', 'medium', 'high', 'xhigh', 'max'].includes(opts.effort))
    throw new RangeError('unsupported effort');
  if (opts.schema && (opts.schema.type !== 'object' || !opts.schema.properties ||
      !Array.isArray(opts.schema.required ?? []))) throw new TypeError('schema must be a JSON object schema');
  const controller = new AbortController();
  if (signal?.aborted) controller.abort(signal.reason);
  signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  const options = { cwd, model: opts.model, effort: opts.effort,
    permissionMode: sandbox === 'read-only' ? 'dontAsk' : 'acceptEdits',
    permissionPrompts: 'none',
    tools: sandbox === 'read-only' ? ['Read', 'Grep', 'Glob'] : ['Read', 'Grep', 'Glob', 'Edit', 'Write'],
    sandbox: { enabled: true }, settingSources: [], strictMcpConfig: true,
    abortController: controller,
    ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
    ...(opts.schema ? { outputFormat: { type: 'json_schema', schema: opts.schema } } : {}),
  };
  let completed;
  for await (const message of runQuery({ prompt: `${SUBAGENT_INSTRUCTIONS}\n\nTask:\n${prompt}`, options }))
    if (message.type === 'result') completed = message;
  if (!completed || completed.subtype !== 'success' || completed.is_error)
    throw new Error(`Claude SDK failed: ${completed?.subtype ?? 'no result'}`);
  const result = opts.schema ? completed.structured_output : completed.result;
  if (opts.schema && (typeof result !== 'object' || result === null || Array.isArray(result)))
    throw new TypeError('Claude returned a non-object structured result');
  const usage = completed.usage?.output_tokens ?? 0;
  return { result, outputTokens: Number.isSafeInteger(usage) && usage >= 0 ? usage : 0 };
}
