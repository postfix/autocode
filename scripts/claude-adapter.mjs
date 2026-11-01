import { query } from '@anthropic-ai/claude-agent-sdk';
import { subagentPrompt } from './subagent-prompt.mjs';

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
  const tools=new Map();
  for await (const message of runQuery({ prompt: subagentPrompt(prompt, !!opts.schema), options })) {
    for(const block of Array.isArray(message.message?.content)?message.message.content:[]) {
      if(block.type==='tool_use'){tools.set(block.id,block.name);context.onActivity?.({id:block.id,tool:block.name,status:'running'});}
      if(block.type==='tool_result')context.onActivity?.({id:block.tool_use_id,tool:tools.get(block.tool_use_id)??'tool',status:block.is_error?'failed':'completed',message:block.is_error?(typeof block.content==='string'?block.content:block.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n')):undefined});
    }
    if (message.type === 'result') completed = message;
  }
  if (!completed || completed.subtype !== 'success' || completed.is_error)
    throw new Error(`Claude SDK failed: ${completed?.subtype ?? 'no result'}${completed?.errors?.length?': '+completed.errors.join('; '):''}`);
  const result = opts.schema ? completed.structured_output : completed.result;
  if (opts.schema && (typeof result !== 'object' || result === null || Array.isArray(result)))
    throw new TypeError('Claude returned a non-object structured result');
  const usage = completed.usage?.output_tokens ?? 0;
  if(Number.isSafeInteger(completed.usage?.input_tokens))context.onUsage?.({inputTokens:completed.usage.input_tokens+(completed.usage.cache_read_input_tokens??0)+(completed.usage.cache_creation_input_tokens??0),cachedInputTokens:completed.usage.cache_read_input_tokens});
  return { result, outputTokens: Number.isSafeInteger(usage) && usage >= 0 ? usage : 0 };
}
