import { Codex } from '@openai/codex-sdk';
import { subagentPrompt } from './subagent-prompt.mjs';

function codexSchema(schema) {
  const result = { ...schema };
  if (schema.properties) result.properties = Object.fromEntries(
    Object.entries(schema.properties).map(([name, property]) => [name, codexSchema(property)]));
  if (schema.items) result.items = codexSchema(schema.items);
  for (const key of ['$defs', 'definitions'])
    if (schema[key]) result[key] = Object.fromEntries(
      Object.entries(schema[key]).map(([name, definition]) => [name, codexSchema(definition)]));
  for (const key of ['anyOf', 'oneOf', 'allOf'])
    if (schema[key]) result[key] = schema[key].map(codexSchema);
  if (schema.type === 'object') {
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== false)
      throw new TypeError('Codex structured output requires additionalProperties: false');
    const keys = Object.keys(schema.properties ?? {});
    if (!Array.isArray(schema.required) || keys.some(key => !schema.required.includes(key)))
      throw new TypeError('Codex structured output requires every property; use a nullable type for optional values');
    result.additionalProperties = false;
  }
  return result;
}

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
  const turn = await thread.run(subagentPrompt(prompt, !!opts.schema),
    { outputSchema: opts.schema ? codexSchema(opts.schema) : undefined, signal });
  const result = opts.schema ? JSON.parse(turn.finalResponse) : turn.finalResponse.trimEnd();
  if (opts.schema && (typeof result !== 'object' || result === null || Array.isArray(result)))
    throw new TypeError('Codex returned a non-object structured result');
  const usage = turn.usage?.output_tokens ?? 0;
  return { result, outputTokens: Number.isSafeInteger(usage) && usage >= 0 ? usage : 0 };
}
