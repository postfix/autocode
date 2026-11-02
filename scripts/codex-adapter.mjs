import { resultValidator } from './schema.mjs';
import { Codex } from '@openai/codex-sdk';
import { subagentInstructions } from './subagent-prompt.mjs';
import { normalizeFailure } from './codex-app-server.mjs';

const nativeSchemaKeywords = new Set(['$schema','$id','$defs','definitions','$ref','type','title','description','properties','required','additionalProperties','items','enum','const','anyOf','oneOf','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','minLength','maxLength','pattern','format','minItems','maxItems']);

function changesShape(node) {
  return node && typeof node === 'object' && (node.$ref || node.type === 'object' || node.properties ||
    Object.values(node).some(value => Array.isArray(value) ? value.some(changesShape) : changesShape(value)));
}

function codexSchema(schema) {
  if (typeof schema === 'boolean') throw new TypeError('Codex structured output cannot preserve boolean subschemas');
  if (Array.isArray(schema)) throw new TypeError('Codex structured output cannot preserve tuple schemas');
  if (Object.keys(schema).some(key => !nativeSchemaKeywords.has(key)))
    throw new TypeError('Codex structured output requires JSON text for unsupported schema keywords');
  if (!schema.type && !schema.$ref && !schema.anyOf && !schema.oneOf)
    throw new TypeError('Codex structured output requires JSON text for an unconstrained schema type');
  if ([schema.const,...(schema.enum ?? [])].some(value => value !== null && typeof value === 'object'))
    throw new TypeError('Codex structured output requires JSON text for object literal constraints');
  if (Array.isArray(schema.type) && schema.type.includes('object'))
    throw new TypeError('Codex structured output cannot preserve object type unions');
  const result = { ...schema };
  if (schema.properties) result.properties = Object.fromEntries(
    Object.entries(schema.properties).map(([name, property]) => [name, (schema.required ?? []).includes(name) ? codexSchema(property) : {
      type: 'object', description: 'Optional value: set present=false and value=null to omit this property.',
      properties: { present: { type: 'boolean' }, value: { anyOf: [codexSchema(property), { type: 'null' }] } },
      required: ['present', 'value'], additionalProperties: false,
    }]));
  if (schema.items !== undefined) result.items = codexSchema(schema.items);
  for (const key of ['$defs', 'definitions'])
    if (schema[key]) result[key] = Object.fromEntries(
      Object.entries(schema[key]).map(([name, definition]) => [name, codexSchema(definition)]));
  for (const key of ['anyOf', 'oneOf', 'allOf'])
    if (schema[key]) {
      if (schema.type === 'object' || schema.properties || schema[key].some(changesShape)) {
        if (key === 'allOf' || Object.keys(schema).some(name => ![key,'title','description','$defs','definitions'].includes(name)))
          throw new TypeError('Codex structured output cannot preserve object schema composition with sibling constraints or allOf');
        delete result[key];
        result.anyOf = schema[key].map((branch, index) => ({
          type: 'object', properties: {branch: {type:'integer',const:index}, value:codexSchema(branch)},
          required:['branch','value'], additionalProperties:false,
        }));
        continue;
      }
      result[key === 'oneOf' ? 'anyOf' : key] = schema[key].map(codexSchema);
      if (key === 'oneOf') delete result.oneOf;
    }
  if (schema.type === 'object') {
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== false)
      throw new TypeError('Codex structured output requires additionalProperties: false');
    const keys = Object.keys(schema.properties ?? {});
    result.required = keys;
    result.additionalProperties = false;
  }
  return result;
}

function restoreOptional(schema, value, root = schema) {
  if (schema.$ref) {
    if (!schema.$ref.startsWith('#/')) throw new TypeError('Codex optional transport supports only local schema references');
    const referenced = schema.$ref.slice(2).split('/').reduce((node, key) => node[key.replace(/~1/g, '/').replace(/~0/g, '~')], root);
    return restoreOptional(referenced, value, root);
  }
  for (const key of ['anyOf','oneOf']) {
    if (schema[key]?.some(changesShape)) {
      if (!value || !Number.isInteger(value.branch) || value.branch < 0 || value.branch >= schema[key].length || !Object.hasOwn(value,'value'))
        throw new TypeError('invalid Codex union-branch transport');
      return restoreOptional(schema[key][value.branch], value.value, root);
    }
  }
  if (Array.isArray(value) && schema.items) return value.map(item => restoreOptional(schema.items, item, root));
  if (value && typeof value === 'object' && !Array.isArray(value) && schema.properties) {
    const output = { ...value };
    for (const [key, property] of Object.entries(schema.properties)) {
      if (!Object.hasOwn(value, key)) continue;
      if ((schema.required ?? []).includes(key)) output[key] = restoreOptional(property, value[key], root);
      else {
        const wrapped = value[key];
        if (!wrapped || typeof wrapped.present !== 'boolean') throw new TypeError('invalid Codex optional-property transport');
        if (wrapped.present) output[key] = restoreOptional(property, wrapped.value, root);
        else delete output[key];
      }
    }
    return output;
  }
  return value;
}

export async function codexAgent(prompt, opts = {}, context = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('agent prompt must be non-empty');
  const { executable, cwd = process.cwd(), runDir, signal } = context;
  if (!runDir) throw new TypeError('runDir is required');
  const transport = context.hostContext?.providers?.codex?.transport ?? 'exec';
  if (!['exec','app-server'].includes(transport)) throw new TypeError('unsupported Codex transport');
  const CodexClass = context.Codex ?? (transport === 'app-server' ? (await import('./codex-app-server.mjs')).AppServerCodex : Codex);
  if (context.hostContext?.canUseTool) throw new TypeError('Codex SDK adapter cannot enforce host permission callbacks');
  if (!Array.isArray(opts.disallowedTools ?? []) || (opts.disallowedTools ?? []).some(name => name !== 'Bash')) throw new TypeError('disallowedTools: Codex SDK adapter cannot enforce this restriction');
  if (opts.bashCommandClamp !== undefined && (!Array.isArray(opts.bashCommandClamp) || opts.bashCommandClamp.length > 0)) throw new TypeError('bashCommandClamp: Codex SDK adapter cannot enforce this restriction');
  const custom = opts.agentType === undefined ? undefined : Object.hasOwn(context.hostContext?.agents ?? {}, opts.agentType) ? context.hostContext.agents[opts.agentType] : undefined;
  if (opts.agentType !== undefined && typeof custom?.prompt !== 'string') throw new TypeError('agentType is not in the trusted host registry');
  if (custom?.tools || custom?.disallowedTools?.length) throw new TypeError('Codex SDK adapter cannot enforce custom-agent tool restrictions');
  if (opts.isolation !== undefined && !(opts.isolation === 'worktree' && context.worktree === cwd)) throw new TypeError('Codex SDK adapter does not support worktree isolation');
  const sandbox = opts.sandbox ?? 'read-only';
  if (!['read-only', 'workspace-write'].includes(sandbox)) throw new RangeError('unsupported sandbox mode');
  if (opts.effort !== undefined && !['low', 'medium', 'high', 'xhigh', 'max'].includes(opts.effort))
    throw new RangeError('unsupported effort');
  if (opts.schema && (opts.schema.type !== 'object' || !opts.schema.properties ||
      !Array.isArray(opts.schema.required ?? []))) throw new TypeError('schema must be a JSON object schema');
  const validateResult = resultValidator(opts.schema);
  let outputSchema, textSchema = false;
  if (opts.schema) {
    try { outputSchema = codexSchema(opts.schema); }
    catch (error) {
      if (!(error instanceof TypeError) || !error.message.startsWith('Codex structured output')) throw error;
      textSchema = true;
    }
  }
  const codexHome = context.hostContext?.providers?.codex?.codexHome;
  if (codexHome !== undefined && (typeof codexHome !== 'string' || !codexHome.trim())) throw new TypeError('codexHome must be a non-empty path');
  const client = new CodexClass({ ...(codexHome ? { env: { ...process.env, CODEX_HOME: codexHome } } : {}), ...(executable ? { codexPathOverride: executable } : {}),
    config: { developer_instructions: [context.hostContext?.instructions, subagentInstructions(!!opts.schema && !textSchema, custom?.prompt),
      textSchema ? `Return ONLY a JSON object, without Markdown fences or commentary, satisfying this JSON Schema: ${JSON.stringify(opts.schema)}` : undefined].filter(Boolean).join('\n\n'),
      features: { multi_agent: false, ...((opts.disallowedTools ?? []).includes('Bash') ? { shell_tool: false } : {}) },
      ...(context.hostContext?.providers?.codex?.mcpServers ? {mcp_servers: context.hostContext.providers.codex.mcpServers} : {}) } });
  const thread = client.startThread({ workingDirectory: cwd, sandboxMode: sandbox,
    model: opts.model, modelReasoningEffort: opts.effort,
    skipGitRepoCheck: true, approvalPolicy: 'never' });
  const options={ outputSchema, signal };
  let task = prompt, outputTokens = 0, usageIncomplete = false, inputTokens = 0, cachedInputTokens = 0;
  const reportUsage = usage => {
    if (Number.isSafeInteger(usage?.output_tokens) && usage.output_tokens >= 0) outputTokens += usage.output_tokens;
    else usageIncomplete = true;
    if (Number.isSafeInteger(usage?.input_tokens) && usage.input_tokens >= 0) inputTokens += usage.input_tokens;
    if (Number.isSafeInteger(usage?.cached_input_tokens) && usage.cached_input_tokens >= 0) cachedInputTokens += usage.cached_input_tokens;
    context.onUsage?.({outputTokens,inputTokens:Number.isSafeInteger(usage?.input_tokens)?inputTokens:undefined,cachedInputTokens:Number.isSafeInteger(usage?.cached_input_tokens)?cachedInputTokens:undefined});
  };
  try {
  for (let repair = 0; repair < 3; repair++) {
  let turn;
  if((context.onActivity||context.onResponse)&&typeof thread.runStreamed==='function') {
    const stream=await thread.runStreamed(task,options);
    let finalResponse='',usage;
    for await(const event of stream.events) {
      if(event.type==='turn.failed'||event.type==='error')throw Object.assign(Error(event.error?.message??event.message??'Codex turn failed'),event.error,event.usage?{usage:event.usage}:{});
      if(event.type==='turn.completed')usage=event.usage;
      const item=event.item;
      if (['item.started','item.updated','item.completed'].includes(event.type) && ['reasoning','agent_message','command_execution','mcp_tool_call','file_change','web_search','todo_list'].includes(item?.type)) context.onResponse?.();
      if(event.type==='item.completed'&&item?.type==='agent_message')finalResponse=item.text;
      if(['item.started','item.completed'].includes(event.type)&&['command_execution','mcp_tool_call','file_change','error'].includes(item?.type)) {
        const failed=item.status==='failed'||typeof item.exit_code==='number'&&item.exit_code!==0||item.type==='error';
        context.onActivity?.({id:item.id,tool:item.type==='mcp_tool_call'?item.tool:item.type,status:failed?'failed':event.type==='item.started'?'running':'completed',exitCode:item.exit_code,message:failed?item.aggregated_output??item.error?.message??item.message:undefined});
      }
    }
    if(!usage)throw Error('Codex stream ended without a completed turn');
    turn={finalResponse,usage};
  }else { turn=await thread.run(task,options); context.onResponse?.(); }
  reportUsage(turn.usage);
  try {
  const result = opts.schema ? (textSchema ? JSON.parse(turn.finalResponse) : restoreOptional(opts.schema, JSON.parse(turn.finalResponse))) : turn.finalResponse.trimEnd();
  if (opts.schema && (typeof result !== 'object' || result === null || Array.isArray(result)))
    throw new TypeError('Codex returned a non-object structured result');
  validateResult(result);

  return { result, outputTokens, ...(usageIncomplete ? {usageIncomplete:true} : {}) };
  } catch(error) {
    if (!opts.schema || repair === 2) throw error;
    task = `Your previous result failed validation: ${error.message}. Return a corrected result matching the supplied schema. Original task: ${prompt}`;
  }
  }
  } catch (error) {
    if (error?.usage) reportUsage(error.usage);
    if (error && typeof error === 'object' && !error.kind) Object.assign(error, normalizeFailure(error));
    throw error;
  } finally { await thread.close?.(); }
}
