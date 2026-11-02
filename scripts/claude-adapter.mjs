import { resultValidator } from './schema.mjs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { subagentInstructions } from './subagent-prompt.mjs';

export async function claudeAgent(prompt, opts = {}, context = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('agent prompt must be non-empty');
  const { query: runQuery = query, executable, cwd = process.cwd(), runDir, signal } = context;
  if (!runDir) throw new TypeError('runDir is required');
  if (context.hostContext?.canUseTool !== undefined && typeof context.hostContext.canUseTool !== 'function') throw new TypeError('host canUseTool must be a function');
  const custom = opts.agentType === undefined ? undefined : Object.hasOwn(context.hostContext?.agents ?? {}, opts.agentType) ? context.hostContext.agents[opts.agentType] : undefined;
  if (opts.agentType !== undefined && typeof custom?.prompt !== 'string') throw new TypeError('agentType is not in the trusted host registry');
  for (const limits of [custom?.tools, custom?.disallowedTools])
    if (limits !== undefined && (!Array.isArray(limits) || limits.some(value => typeof value !== 'string' || !value.trim() || value !== value.trim()))) throw new TypeError('agent registry tool restrictions must be arrays of non-empty tool names');
  if (opts.isolation !== undefined && !(opts.isolation === 'worktree' && context.worktree === cwd)) throw new TypeError('Claude SDK adapter does not support worktree isolation');
  const sandbox = opts.sandbox ?? 'read-only';
  if (!['read-only', 'workspace-write'].includes(sandbox)) throw new RangeError('unsupported sandbox mode');
  if (opts.effort !== undefined && !['low', 'medium', 'high', 'xhigh', 'max'].includes(opts.effort))
    throw new RangeError('unsupported effort');
  if (opts.schema && (opts.schema.type !== 'object' || !opts.schema.properties ||
      !Array.isArray(opts.schema.required ?? []))) throw new TypeError('schema must be a JSON object schema');
  const validateResult = resultValidator(opts.schema);
  const disallowedTools = [...(custom?.disallowedTools ?? []), ...(opts.disallowedTools ?? [])];
  if (!Array.isArray(opts.disallowedTools ?? []) || disallowedTools.some(value => typeof value !== 'string' || !value.trim() || value !== value.trim())) throw new TypeError('disallowedTools must contain non-empty tool names');
  for (const rule of disallowedTools) {
    const parsed = /^([^\s()]+)(?:\([\s\S]*\))?$/.exec(rule);
    if (!parsed) throw new TypeError('disallowedTools rule cannot match a native tool');
    const tool = parsed[1];
    if (tool.startsWith('mcp__')) {
      const [server, ...name] = tool.slice(5).split('__');
      if (!server || (server.includes('*') && server !== '*') || name.some(part => !part || (part.includes('*') && part !== '*')))
        throw new TypeError('disallowedTools MCP rule cannot match a native tool');
    } else if (tool.includes('*')) throw new TypeError('disallowedTools wildcard cannot match a native tool');
    const canonical = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'].find(name => name.toLowerCase() === tool.toLowerCase());
    if (canonical && canonical !== tool) throw new TypeError(`disallowedTools tool names are case-sensitive; use ${canonical}`);
  }
  if (opts.bashCommandClamp !== undefined && (!Array.isArray(opts.bashCommandClamp) || opts.bashCommandClamp.length > 0)) throw new TypeError('bashCommandClamp: Claude SDK adapter cannot enforce this restriction yet');
  const controller = new AbortController();
  if (signal?.aborted) controller.abort(signal.reason);
  signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  const options = { systemPrompt: [context.hostContext?.instructions, subagentInstructions(!!opts.schema, custom?.prompt)].filter(Boolean).join('\n\n'), cwd, model: opts.model, effort: opts.effort,
    permissionMode: sandbox === 'read-only' ? 'dontAsk' : 'acceptEdits',
    permissionPrompts: 'none',
    tools: sandbox === 'read-only' ? ['Read', 'Grep', 'Glob'] : ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
    sandbox: { enabled: true }, settingSources: [], strictMcpConfig: true,
    abortController: controller,
    ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
    ...(opts.schema ? { outputFormat: { type: 'json_schema', schema: opts.schema } } : {}),
  };
  if (context.hostContext?.canUseTool) {
    options.canUseTool = context.hostContext.canUseTool;
    options.permissionPrompts = 'host';
    options.permissionMode = 'default';
    options.hooks = {PreToolUse:[{hooks:[async () => ({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'ask',permissionDecisionReason:'The trusted host permission policy must approve this tool call'}})]}]};
  }
  if (context.hostContext?.providers?.claude?.mcpServers) options.mcpServers = context.hostContext.providers.claude.mcpServers;
  if (custom?.tools) {
    options.tools = options.tools.filter(tool => custom.tools.includes(tool));
    options.agent = 'autocode-workflow';
    options.agents = {'autocode-workflow': {description:'Workflow agent with trusted tool restrictions',prompt:options.systemPrompt,tools:[...custom.tools]}};
  }
  if (disallowedTools.length) options.disallowedTools = disallowedTools;
  let task = prompt, outputTokens = 0, inputTokens = 0, cachedInputTokens = 0, usageIncomplete = false;
  const tools=new Map();
  for (let repair = 0; repair < 3; repair++) {
  let completed, apiError, rateLimit;
  for await (const message of runQuery({ prompt: task, options })) {
    if ((message.type === 'assistant' && !message.error) || (message.type === 'stream_event' && message.event?.type === 'message_start')) context.onResponse?.();
    if (message.type === 'assistant' && message.error) apiError = message.error;
    if (message.type === 'rate_limit_event' && message.rate_limit_info?.status === 'rejected') rateLimit = message.rate_limit_info;
    for(const block of Array.isArray(message.message?.content)?message.message.content:[]) {
      if(block.type==='tool_use'){tools.set(block.id,block.name);context.onActivity?.({id:block.id,tool:block.name,status:'running'});}
      if(block.type==='tool_result')context.onActivity?.({id:block.tool_use_id,tool:tools.get(block.tool_use_id)??'tool',status:block.is_error?'failed':'completed',message:block.is_error?(typeof block.content==='string'?block.content:block.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n')):undefined});
    }
    if (message.type === 'result') {
      completed = message;
      if (Number.isSafeInteger(message.usage?.output_tokens) && message.usage.output_tokens >= 0) outputTokens += message.usage.output_tokens;
      if (!Number.isSafeInteger(message.usage?.output_tokens) || message.usage.output_tokens < 0) usageIncomplete = true;
      if (Number.isSafeInteger(message.usage?.input_tokens)) inputTokens += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
      if (Number.isSafeInteger(message.usage?.cache_read_input_tokens)) cachedInputTokens += message.usage.cache_read_input_tokens;
      context.onUsage?.({outputTokens,...(Number.isSafeInteger(message.usage?.input_tokens) ? {inputTokens} : {}),...(Number.isSafeInteger(message.usage?.cache_read_input_tokens) ? {cachedInputTokens} : {})});
    }
  }
  if (!completed || completed.subtype !== 'success' || completed.is_error) {
    const error = new Error(`Claude SDK failed: ${completed?.subtype ?? 'no result'}${completed?.errors?.length?': '+completed.errors.join('; '):''}`);
    if (apiError) error.kind = 'api-error';
    if (['authentication_failed','oauth_org_not_allowed','account_on_hold','verification_required','billing_error','invalid_request','model_not_found','cloud_credential_error'].includes(apiError)) error.kind = 'terminal-api';
    if (apiError === 'rate_limit' || rateLimit) { error.kind = 'rate-limit'; error.rateLimit = rateLimit; }
    if (['overloaded','server_error'].includes(apiError)) error.kind = 'transient-api';
    throw error;
  }
  try {
  const result = opts.schema ? completed.structured_output : completed.result;
  if (opts.schema && (typeof result !== 'object' || result === null || Array.isArray(result)))
    throw new TypeError('Claude returned a non-object structured result');
  validateResult(result);

  return { result, outputTokens, ...(completed.duration_ms !== undefined ? {durationMs:completed.duration_ms} : {}), ...(completed.stop_reason !== undefined ? {stopReason:completed.stop_reason} : {}), ...(usageIncomplete ? {usageIncomplete:true} : {}) };
  } catch(error) {
    if (!opts.schema || repair === 2) throw error;
    if (completed.session_id) options.resume = completed.session_id;
    task = `Your previous result failed validation: ${error.message}. Return a corrected result matching the supplied schema. Original task: ${prompt}`;
  }
  }
}
