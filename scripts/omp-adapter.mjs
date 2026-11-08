import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resultValidator } from './schema.mjs';
import { subagentInstructions } from './subagent-prompt.mjs';

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const SANDBOXES = new Set(['read-only', 'workspace-write']);
// OMP builtin tool names. Read-only parity with the Claude adapter's
// ['Read','Grep','Glob'] restriction: no bash/edit/write/eval/task.
const READ_ONLY_TOOLS = 'read,grep,glob';
const DEFAULT_MAX_REASSEMBLED = 64 * 1024 * 1024;

function systemPrompt(opts, context) {
  const parts = [context.hostContext?.instructions, subagentInstructions(false)];
  if (opts.schema) parts.push(`Return ONLY a JSON object, without Markdown fences or commentary, satisfying this JSON Schema: ${JSON.stringify(opts.schema)}`);
  return parts.filter(Boolean).join('\n\n');
}

function messageText(message) {
  if (Array.isArray(message?.content)) {
    const text = message.content
      .filter(block => block && block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('');
    if (text) return text;
  }
  return null;
}

export async function ompAgent(prompt, opts = {}, context = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('agent prompt must be non-empty');
  const { executable = 'omp', cwd = process.cwd(), runDir, signal, hostContext } = context;
  if (!runDir) throw new TypeError('runDir is required');
  const sandbox = opts.sandbox ?? 'read-only';
  if (!SANDBOXES.has(sandbox)) throw new RangeError('unsupported sandbox mode');
  if (opts.effort !== undefined && !EFFORTS.has(opts.effort)) throw new RangeError('unsupported effort');
  if (opts.schema && (opts.schema.type !== 'object' || !opts.schema.properties || !Array.isArray(opts.schema.required ?? [])))
    throw new TypeError('schema must be a JSON object schema');
  const validateResult = resultValidator(opts.schema);
  if (!Array.isArray(opts.disallowedTools ?? []) || (opts.disallowedTools ?? []).some(name => typeof name !== 'string' || !name.trim() || name !== name.trim()))
    throw new TypeError('disallowedTools must contain non-empty tool names');
  if ((opts.disallowedTools ?? []).length) throw new TypeError('disallowedTools: OMP RPC adapter cannot enforce this restriction');
  if (opts.bashCommandClamp !== undefined && (!Array.isArray(opts.bashCommandClamp) || opts.bashCommandClamp.length > 0))
    throw new TypeError('bashCommandClamp: OMP RPC adapter cannot enforce this restriction');
  const custom = opts.agentType === undefined ? undefined
    : Object.hasOwn(hostContext?.agents ?? {}, opts.agentType) ? hostContext.agents[opts.agentType] : undefined;
  if (opts.agentType !== undefined && typeof custom?.prompt !== 'string') throw new TypeError('agentType is not in the trusted host registry');
  if (custom?.tools || custom?.disallowedTools?.length) throw new TypeError('OMP RPC adapter cannot enforce custom-agent tool restrictions');
  if (opts.isolation !== undefined && !(opts.isolation === 'worktree' && context.worktree === cwd))
    throw new TypeError('OMP RPC adapter does not support worktree isolation');

  const spawnFn = context.spawn ?? spawn;
  const args = ['--mode', 'rpc', '--no-ui', '--no-session', '--cwd', cwd];
  if (opts.model) args.push('--model', opts.model);
  if (opts.effort) args.push('--thinking', opts.effort);
  if (sandbox === 'read-only') args.push('--tools', READ_ONLY_TOOLS);
  else args.push('--yolo');
  const sys = systemPrompt(opts, context);
  if (sys) args.push('--system-prompt', sys);

  const child = spawnFn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let seq = 0;
  const write = (obj) => { try { child.stdin.write(`${JSON.stringify(obj)}\n`); } catch { /* child already gone */ } };
  // Negotiate protocol v2 up front so oversized stdout objects arrive as
  // rpc_chunk frames instead of being elided at the v1 1 MiB frame cap.
  write({ id: 'protocol-1', type: 'negotiate_protocol', protocolVersion: 2 });

  let finalText = '';
  let currentAssistantText = '';
  let outputTokens = 0, inputTokens = 0, cachedInputTokens = 0, usageIncomplete = false;
  let pendingResolve = null, pendingReject = null, statsResolve = null, statsTimer = null;
  let aborted = null;
  let maxReassembled = DEFAULT_MAX_REASSEMBLED;
  // Single in-flight rpc_chunk sequence (the protocol emits them uninterrupted).
  let chunkSeq = null;

  const abort = () => {
    aborted = signal?.reason ?? new Error('OMP agent aborted');
    write({ type: 'abort' });
    const kill = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already dead */ } }, 1000);
    kill.unref?.();
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });

  const settleStats = () => {
    if (statsTimer) { clearTimeout(statsTimer); statsTimer = null; }
    statsResolve?.();
    statsResolve = null;
  };

  const handleFrame = (frame) => {
    if (frame.type === 'response') {
      if (frame.command === 'prompt') {
        if (frame.success === false) {
          const err = new Error(frame.error ?? 'OMP prompt failed');
          if (frame.code) err.code = frame.code;
          pendingReject?.(err);
        } else if (frame.data?.agentInvoked === false) {
          pendingResolve?.({ status: 'completed', text: finalText });
        }
      } else if (frame.command === 'get_session_stats') {
        if (frame.success && frame.data?.tokens) {
          const t = frame.data.tokens;
          outputTokens = Number.isSafeInteger(t.output) && t.output >= 0 ? t.output : 0;
          inputTokens = Number.isSafeInteger(t.input) && t.input >= 0 ? t.input : 0;
          cachedInputTokens = Number.isSafeInteger(t.cacheRead) && t.cacheRead >= 0 ? t.cacheRead : 0;
        } else usageIncomplete = true;
        settleStats();
      }
      return;
    }
    if (frame.type === 'prompt_result') {
      if (frame.status === 'aborted') pendingReject?.(aborted ?? new Error('OMP agent aborted'));
      else if (frame.status === 'error') {
        const err = new Error(frame.error?.message ?? 'OMP agent failed');
        err.kind = frame.error?.retryable ? 'transient-api' : 'api-error';
        if (frame.error?.code) err.code = frame.error.code;
        pendingReject?.(err);
      } else pendingResolve?.({ status: frame.status, text: finalText });
      return;
    }
    switch (frame.type) {
      case 'message_start':
        if (frame.message?.role === 'assistant') { currentAssistantText = ''; context.onResponse?.(); }
        break;
      case 'message_update': {
        const ev = frame.assistantMessageEvent;
        if (ev?.type === 'text_delta' && typeof ev.delta === 'string') currentAssistantText += ev.delta;
        if (ev) context.onResponse?.();
        break;
      }
      case 'message_end':
        if (frame.message?.role === 'assistant') {
          const text = messageText(frame.message) ?? currentAssistantText;
          if (text) finalText = text;
        }
        break;
      case 'tool_execution_start':
        context.onActivity?.({ id: frame.toolCallId ?? frame.toolName, tool: frame.toolName, status: 'running' });
        break;
      case 'tool_execution_end':
        context.onActivity?.({
          id: frame.toolCallId ?? frame.toolName,
          tool: frame.toolName,
          status: frame.isError ? 'failed' : 'completed',
          ...(frame.isError && frame.result?.error ? { message: String(frame.result.error) } : {}),
        });
        break;
    }
  };

  const ingest = (frame) => {
    if (frame?.type === 'rpc_chunk') {
      const id = frame.chunkId;
      if (typeof id !== 'string' || !id ||
          !Number.isInteger(frame.index) || !Number.isInteger(frame.count) ||
          frame.count <= 0 || frame.index < 0 || frame.index >= frame.count ||
          !Number.isSafeInteger(frame.byteLength) || frame.byteLength < 0 || frame.byteLength > maxReassembled) {
        chunkSeq = null;
        return;
      }
      if (!chunkSeq || chunkSeq.id !== id || chunkSeq.count !== frame.count || chunkSeq.byteLength !== frame.byteLength) {
        chunkSeq = { id, count: frame.count, byteLength: frame.byteLength, parts: new Map(), bytes: 0 };
      }
      if (chunkSeq.parts.has(frame.index)) { chunkSeq = null; return; }
      let buf;
      try { buf = Buffer.from(typeof frame.data === 'string' ? frame.data : '', 'base64'); } catch { chunkSeq = null; return; }
      chunkSeq.parts.set(frame.index, buf);
      chunkSeq.bytes += buf.length;
      if (chunkSeq.bytes > maxReassembled) { chunkSeq = null; return; }
      if (chunkSeq.parts.size !== chunkSeq.count) return;
      const seq = chunkSeq;
      chunkSeq = null;
      if (seq.bytes !== seq.byteLength) return;
      const full = Buffer.concat([...seq.parts.entries()].sort((a, b) => a[0] - b[0]).map(entry => entry[1]));
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(full); } catch { return; }
      let reassembled;
      try { reassembled = JSON.parse(text); } catch { return; }
      handleFrame(reassembled);
      return;
    }
    chunkSeq = null; // a non-chunk frame interrupts any incomplete sequence
    handleFrame(frame);
  };

  rl.on('line', (line) => {
    let frame;
    try { frame = JSON.parse(line); } catch { return; }
    if (frame?.type === 'ready') {
      if (Number.isSafeInteger(frame.maxReassembledFrameBytes) && frame.maxReassembledFrameBytes > 0) maxReassembled = frame.maxReassembledFrameBytes;
      return;
    }
    ingest(frame);
  });

  rl.on('close', () => {
    if (aborted) pendingReject?.(aborted);
    else pendingReject?.(new Error('OMP RPC stream ended before the prompt completed'));
    settleStats();
  });
  child.on('error', (err) => { pendingReject?.(err); settleStats(); });

  const runPrompt = (task) => new Promise((resolve, reject) => {
    pendingResolve = resolve;
    pendingReject = reject;
    finalText = '';
    currentAssistantText = '';
    write({ id: `p${++seq}`, type: 'prompt', message: task });
  });

  const sessionStats = () => new Promise((resolve) => {
    statsResolve = resolve;
    statsTimer = setTimeout(() => { usageIncomplete = true; settleStats(); }, 5000);
    statsTimer.unref?.();
    write({ id: `s${++seq}`, type: 'get_session_stats' });
  });

  let result;
  try {
    let task = prompt;
    for (let repair = 0; repair < 3; repair++) {
      const turn = await runPrompt(task);
      if (turn.status !== 'completed') throw new Error('OMP agent did not complete');
      try {
        result = opts.schema ? JSON.parse(turn.text) : turn.text.trimEnd();
        if (opts.schema && (typeof result !== 'object' || result === null || Array.isArray(result)))
          throw new TypeError('OMP returned a non-object structured result');
        validateResult(result);
        break;
      } catch (error) {
        if (!opts.schema || repair === 2) throw error;
        task = `Your previous result failed validation: ${error.message}. Return a corrected result matching the supplied schema. Original task: ${prompt}`;
      }
    }
  } finally {
    signal?.removeEventListener('abort', abort);
  }

  await sessionStats();
  context.onUsage?.({ outputTokens, ...(usageIncomplete ? {} : { inputTokens, cachedInputTokens }) });

  rl.close();
  try { child.stdin.end(); } catch { /* already gone */ }
  const exited = new Promise(resolve => child.once('exit', resolve));
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  await Promise.race([exited, new Promise(resolve => { const timer = setTimeout(resolve, 1500); timer.unref?.(); })]);
  if (child.exitCode === null && child.signalCode === null) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }

  return { result, outputTokens, ...(usageIncomplete ? { usageIncomplete: true } : {}) };
}
