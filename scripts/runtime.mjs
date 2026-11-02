import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFile, mkdir, readFile, writeFile, rename, copyFile, rm } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const executeFile = promisify(execFile);
import { Script, createContext } from 'node:vm';
import { parseExpressionAt } from 'acorn';
import { safeText } from './run-stats.mjs';

const hostPrefixGates = new WeakMap();
function prefixGate() {
  const entries = new Map();
  return async (key, signal) => {
    const now = Date.now();
    for (const [name, entry] of entries) if (entry.until && entry.until <= now) entries.delete(name);
    const existing = entries.get(key);
    let owner;
    if (!existing) {
      let release;
      const ready = new Promise(resolve => { release = resolve; });
      owner = {ready,release}; entries.set(key,owner);
    } else if (!existing.until && !process.env.DISABLE_PROMPT_CACHING) {
      const configured = Number(process.env.CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS ?? 5000);
      const cap = Number.isFinite(configured) && configured >= 0 ? configured : 5000;
      await new Promise(resolve => {
        const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort',finish); resolve(); };
        const timer = setTimeout(finish,cap);
        existing.ready.then(finish);
        if (signal?.aborted) finish(); else signal?.addEventListener('abort',finish,{once:true});
      });
    }
    let responded = false;
    return {
      responded() { responded = true; const entry = entries.get(key); entries.set(key,{until:Date.now()+270000}); entry?.release?.(); },
      done() { if (!responded && owner && entries.get(key) === owner) { entries.delete(key); owner.release(); } },
    };
  };
}

function parseHeader(source) {
  const comment = /^\/\* autocode ([^\n]*?) \*\/[\r\n]+/.exec(source);
  if (comment) return { meta: JSON.parse(comment[1]), body: source.slice(comment[0].length) };
  const exported = /^export\s+const\s+meta\s*=\s*\{/.exec(source);
  if (!exported) throw new SyntaxError('workflow must start with JSON autocode metadata or export const meta');
  const expression = parseExpressionAt(source, exported[0].length - 1, { ecmaVersion: 'latest' });
  const literal = (node) => {
    if (node.type === 'Literal' && !node.regex && !node.bigint) return node.value;
    if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal' && typeof node.argument.value === 'number') return -node.argument.value;
    if (node.type === 'ArrayExpression') return node.elements.map(item => {
      if (!item) throw new SyntaxError('meta must be a pure literal');
      return literal(item);
    });
    if (node.type === 'ObjectExpression') {
      const result = {};
      for (const property of node.properties) {
        if (property.type !== 'Property' || property.computed || property.method || property.shorthand || property.kind !== 'init')
          throw new SyntaxError('meta must be a pure literal');
        const key = property.key.type === 'Identifier' ? property.key.name : String(property.key.value);
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new SyntaxError('reserved key in meta');
        result[key] = literal(property.value);
      }
      return result;
    }
    throw new SyntaxError('meta must be a pure literal');
  };
  const meta = literal(expression);
  return { meta, body: source.slice(expression.end).replace(/^\s*;?/, '') };
}

export function workflowMetadata(source) {
  const { meta } = parseHeader(source);
  if (typeof meta.name !== 'string' || !meta.name.trim() || typeof meta.description !== 'string' || !meta.description.trim()) throw new TypeError('meta.name and meta.description must be non-empty strings');
  return structuredClone(meta);
}

export async function exportWorkflowJournal(source, destination) {
  source = resolve(source); destination = resolve(destination);
  const metadata = JSON.parse(await readFile(join(source, 'run.json'), 'utf8'));
  if (metadata.journalVersion !== 2) throw new Error('only version 2 journals can be exported');
  workflowMetadata(metadata.script);
  await mkdir(dirname(destination), { recursive: true });
  await mkdir(destination, { mode: 0o700 });
  try {
    for (const name of ['run.json', 'journal.jsonl']) await copyFile(join(source, name), join(destination, name), constants.COPYFILE_EXCL);
  } catch(error) { await rm(destination, { recursive: true, force: true }); throw error; }
  return { runId: metadata.runId, directory: destination };
}

export async function importWorkflowJournal(source, destination) {
  const snapshot = await exportWorkflowJournal(source, destination);
  const file = join(snapshot.directory, 'run.json');
  const metadata = JSON.parse(await readFile(file, 'utf8'));
  const runId = `wf_${randomUUID()}`;
  await writeFile(file, JSON.stringify({ ...metadata, runId, importedFromRunId: metadata.runId }));
  return { runId, runDir: snapshot.directory };
}

export async function runWorkflow({ script, args, runDir, agent, budget = null, signal,
  concurrency = Math.min(16, Math.max(2, availableParallelism() - 2)), resumeFromRunId,
  resolveWorkflow, onProgress, defaultProvider, initialRunId, hostContext, cwd = process.cwd(), subscribeControls, executionContext }) {
  if (hostContext && (typeof hostContext.id !== 'string' || !hostContext.id || typeof hostContext.revision !== 'string' || !hostContext.revision)) throw new TypeError('host context requires id and revision');
  if (hostContext && !hostPrefixGates.has(hostContext)) hostPrefixGates.set(hostContext,prefixGate());
  const enterPrefix = hostContext ? hostPrefixGates.get(hostContext) : prefixGate();
  const sharedBudget = hostContext?.budget;
  if (sharedBudget && (typeof sharedBudget.spent !== 'function' || typeof sharedBudget.charge !== 'function')) throw new TypeError('host budget needs spent() and charge()');
  if (sharedBudget) budget = sharedBudget.total;
  if(initialRunId!==undefined&&!/^wf_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(initialRunId))throw new TypeError('invalid initial workflow ID');
  if (typeof script !== 'string') throw new TypeError('script must be a string');
  const { meta } = parseHeader(script);
  if (typeof meta.name !== 'string' || !meta.name.trim() ||
      typeof meta.description !== 'string' || !meta.description.trim())
    throw new TypeError('meta.name and meta.description must be non-empty strings');
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16)
    throw new RangeError('concurrency must be an integer from 1 to 16');
  if (budget !== null && (!Number.isSafeInteger(budget) || budget < 0))
    throw new RangeError('budget must be a non-negative integer or null');
  if (typeof runDir !== 'string' || !runDir) throw new TypeError('runDir must be a directory path');
  await mkdir(runDir, { recursive: true });
  const runFile = join(runDir, 'run.json');
  const journalFile = join(runDir, 'journal.jsonl');
  let runId;
  const cached = new Map();
  const worktrees = [];
  let previousOutputTokens = 0, usageIncomplete = false;
  if (resumeFromRunId) {
    const saved = JSON.parse(await readFile(runFile, 'utf8'));
    if (saved.journalVersion !== 2) throw new Error('Legacy replay journal is incompatible; preserve this directory and start a fresh run');
    if (saved.runId !== resumeFromRunId) throw new Error('resume run ID does not match this directory');
    runId = saved.runId;
    const previous = await readFile(journalFile, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    const lines = previous.split('\n');
    let partial;
    for (const [index, line] of lines.entries()) {
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); }
      catch (error) {
        if (index !== lines.length - 1) throw error;
        partial = line;
        continue;
      }
      if (event.usageIncomplete || event.type === 'failed' || event.type === 'skipped') usageIncomplete = true;
      if (['agent-finished', 'failed', 'skipped'].includes(event.type) && Number.isSafeInteger(event.outputTokens) && event.outputTokens >= 0) previousOutputTokens += event.outputTokens;
      if (event.type === 'worktree-preserved' && typeof event.path === 'string' && !worktrees.some(tree => tree.path === event.path)) worktrees.push({path:event.path});
      if (event.type === 'result') cached.set(event.key, event.result);
      else if (event.type === 'started' || event.type === 'failed' || event.type === 'skipped') cached.delete(event.key);
    }
    if (partial !== undefined) {
      const recovery = `${journalFile}.partial-${randomUUID()}`;
      await writeFile(recovery, partial, { flag: 'wx', mode: 0o600 });
      const repaired = `${journalFile}.repair-${randomUUID()}`;
      await writeFile(repaired, previous.slice(0, previous.length - partial.length), { flag: 'wx', mode: 0o600 });
      await rename(repaired, journalFile);
    } else if (previous && !previous.endsWith('\n')) await appendFile(journalFile, '\n');
  } else {
    runId = initialRunId ?? `wf_${randomUUID()}`;
    await writeFile(runFile, JSON.stringify({ journalVersion: 2, runId, name: meta.name, script, args }), { flag: 'wx' });
  }
  let journalQueue = Promise.resolve();
  const attemptId=randomUUID();
  const record = (event) => {
    const entry={...event,time:Date.now(),attemptId};
    journalQueue=journalQueue.then(()=>appendFile(journalFile,`${JSON.stringify(entry)}\n`));
    journalQueue.catch(()=>{});
    return journalQueue;
  };
  await record({type:'run-started',concurrency,provider:defaultProvider??null,phases:Array.isArray(meta.phases)?meta.phases.slice(0,1000).map(p=>({title:safeText(p?.title,160),detail:safeText(p?.detail)})):[]});
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value;
  };
  const seed = createHash('sha256').update(args === undefined ? 'undefined' : JSON.stringify(canonical(args))).digest('hex');
  const branches = new AsyncLocalStorage();
  const root = { previousKey: seed, replaying: true };
  let agentCount = 0;
  let outputTokens = previousOutputTokens;
  const spent = () => sharedBudget ? sharedBudget.spent() : outputTokens;
  let currentPhase = null;
  const logs = [];
  let active = 0;
  const waiting = [];
  const failures = [];
  const git = (directory, args) => executeFile('git', args, { cwd: directory, env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1' } });
  let activityCount=0;
  const contexts = new AsyncLocalStorage();
  const realmValue = (value) => {
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError('workflow values must be JSON-serializable');
    const context = contexts.getStore();
    context.__autocodeJson = json;
    try { return new Script('JSON.parse(__autocodeJson)').runInContext(context); }
    finally { delete context.__autocodeJson; }
  };
  const inSlot = async (fn) => {
    if (active < concurrency) active++;
    else await new Promise((resolve) => waiting.push(resolve));
    try { return await fn(); }
    finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
  const agentControls = new Map();
  const unsubscribeControls = subscribeControls?.(({agent, command}) => {
    if (!['skip', 'retry'].includes(command)) throw new Error('unsupported agent action');
    const control = agentControls.get(agent);
    if (!control) throw new Error('agent is not currently running');
    control(command);
  });
  const callAgent = async (prompt, opts, context) => {
    const configuredStall = Number(process.env.CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS);
    const configuredIdle = Number(process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS);
    const streamWatchdogDisabled = ['false', '0'].includes(process.env.CLAUDE_ENABLE_STREAM_WATCHDOG?.toLowerCase());
    const defaultStall = streamWatchdogDisabled ? 600000 : Math.min(Math.max(configuredIdle > 0 ? configuredIdle : 0, 300000) + 300000, 2147483647);
    const stallMs = opts.stallMs ?? hostContext?.stallMs ?? (configuredStall > 0 ? configuredStall : defaultStall);
    if (!Number.isSafeInteger(stallMs) || stallMs < 1) throw new TypeError('stallMs must be a positive integer');
    let priorOutput = 0, throttleRetried = false;
    const priorUsage = {};
    for (let attempt = 0; attempt <= 5; attempt++) {
      if (budget !== null && spent() >= budget) throw new Error('Autocode token budget exceeded');
      const controller = new AbortController();
      agentControls.set(context.agentIndex, command => {
        const reason = new Error(`user-${command}`); reason.code = `user-${command}`; controller.abort(reason);
      });
      const attemptSignal = AbortSignal.any([controller.signal, context.signal].filter(Boolean));
      const stalled = new Error('Workflow agent stalled: no progress');
      const activeTools = new Set();
      let watchdog, output = 0, abortListener, warmup;
      let measuredUsage = {};
      const commitUsage = () => {
        for (const [field,value] of Object.entries(measuredUsage)) priorUsage[field] = (priorUsage[field] ?? 0) + value;
        measuredUsage = {};
      };
      const progress = () => {
        clearTimeout(watchdog);
        if (!activeTools.size) watchdog = setTimeout(() => controller.abort(stalled), stallMs);
      };
      const pending = Promise.resolve().then(async () => {
        warmup = await enterPrefix(JSON.stringify([hostContext?.id,hostContext?.revision,opts.provider ?? defaultProvider,opts.model,opts.effort,opts.agentType,opts.schema,opts.disallowedTools,opts.bashCommandClamp,opts.sandbox,context.cwd]),attemptSignal);
        attemptSignal.throwIfAborted();
        progress();
        return agent(prompt, opts, { ...context, signal: attemptSignal,
        onResponse: () => { warmup.responded(); progress(); context.onResponse?.(); },
        onUsage: counts => {
          if (Number.isSafeInteger(counts?.outputTokens)) output = Math.max(output, counts.outputTokens);
          for (const field of ['inputTokens','cachedInputTokens']) if (Number.isSafeInteger(counts?.[field]) && counts[field] >= 0) measuredUsage[field] = counts[field];
          const totals = {...priorUsage};
          for (const [field,value] of Object.entries(measuredUsage)) totals[field] = (priorUsage[field] ?? 0) + value;
          context.onUsage?.({ ...counts, ...totals, outputTokens: priorOutput + output });
          progress();
        },
        onActivity: event => {
          const id = event?.id ?? event?.tool;
          if (event?.status === 'running') activeTools.add(id);
          else activeTools.delete(id);
          progress(); context.onActivity?.(event);
        },
      }); });
      try {
        const response = await Promise.race([pending, new Promise((_, reject) => {
          abortListener = () => reject(attemptSignal.reason);
          if (attemptSignal.aborted) abortListener();
          else attemptSignal.addEventListener('abort', abortListener, { once: true });
        })]);
        if (response?.stalled) {
          output = Math.max(output, Number.isSafeInteger(response.outputTokens) ? response.outputTokens : 0);
          context.onUsage?.({ outputTokens: priorOutput + output });
          if (response.replyLost) stalled.message = 'Workflow agent lost its reply: silent response stream';
          throw stalled;
        }
        const degraded = response && !opts.schema && !response.stalled && !response.skipped && response.stopReason == null &&
          response.structured === undefined && (response.outputTokens ?? Infinity) < 50 &&
          response.durationMs > Math.min(stallMs * 0.5, 90000);
        if (degraded && !throttleRetried) {
          throttleRetried = true;
          priorOutput += Math.max(output, response.outputTokens);
          output = 0;
          commitUsage();
          context.onUsage?.({ outputTokens: priorOutput });
          clearTimeout(watchdog);
          await record({ type: 'retry', attempt: attempt + 2, message: 'throttled response; waiting 45 seconds', reason: 'throttled' });
          await new Promise((resolve, reject) => {
            const signal = attemptSignal;
            const abort = () => { clearTimeout(timer); reject(signal.reason); };
            const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 45000);
            if (signal?.aborted) abort();
            else signal?.addEventListener('abort', abort, { once: true });
          });
          attempt--;
          continue;
        }
        return response && { ...response, outputTokens: Number.isSafeInteger(response.outputTokens) && response.outputTokens >= 0 ? priorOutput + Math.max(output, response.outputTokens) : response.outputTokens };
      } catch (error) {
        if (attemptSignal.aborted) {
          let grace;
          const stopped = await Promise.race([pending.then(() => true, () => true), new Promise(resolve => { grace = setTimeout(() => resolve(false), 1000); })]);
          clearTimeout(grace);
          if (!stopped) { const error = new Error('Workflow agent stalled or cancelled without acknowledging cancellation; retry refused'); error.code = 'cancellation-unconfirmed'; throw error; }
        }
        priorOutput += output;
        commitUsage();
        if (error?.kind === 'rate-limit' && hostContext?.waitForQuota && attempt < 5) {
          clearTimeout(watchdog);
          try {
            const retry = await hostContext.waitForQuota({ provider: opts.provider ?? defaultProvider, rateLimit: error.rateLimit, signal: attemptSignal });
            attemptSignal.throwIfAborted();
            if (retry === true) { await record({type:'quota-retry',attempt:attempt+1}); continue; }
          } catch (waitError) { error = waitError; }
        }
        if ((error !== stalled && error?.kind !== 'lost-reply' && error?.code !== 'user-retry') || (throttleRetried && (error === stalled || error?.kind === 'lost-reply')) || attempt === 5 || context.signal?.aborted) throw error;
        await record({ type: 'retry', attempt: attempt + 1, message: error?.code === 'user-retry' ? 'retry requested by user' : error?.kind === 'lost-reply' ? 'agent lost its reply' : 'agent stalled' });
      } finally {
        warmup?.done();
        agentControls.delete(context.agentIndex);
        clearTimeout(watchdog);
        if (abortListener) attemptSignal.removeEventListener('abort', abortListener);
      }
    }
  };
  const invokeAgent = async (prompt, opts = {}) => {
    signal?.throwIfAborted();
    if (!opts || typeof opts !== 'object' || Array.isArray(opts)) throw new TypeError('agent options must be an object');
    for (const name of Object.keys(opts))
      if (!['provider','model','effort','schema','label','phase','agentType','isolation','disallowedTools','bashCommandClamp','stallMs','sandbox'].includes(name)) throw new TypeError(`unsupported agent option: ${name}`);
    const provider = opts.provider ?? defaultProvider;
    const inherited = hostContext?.providers?.[provider];
    const custom = Object.hasOwn(hostContext?.agents ?? {}, opts.agentType) ? hostContext.agents[opts.agentType] : undefined;
    opts = structuredClone({ ...opts, model: inherited?.forcedModel ?? opts.model ?? (custom?.model === 'inherit' ? undefined : custom?.model) ?? inherited?.model, effort: inherited?.forcedEffort ?? opts.effort ?? custom?.effort ?? inherited?.effort });
    if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('agent prompt must be a non-empty string');
    if (agentCount >= 1000) throw Error('Autocode agent call cap reached (1000)');
    const agentIndex = ++agentCount;
    if (hostContext?.onSpawn) {
      const sharePrompt = hostContext.shareWorkflowPrompt !== false;
      const decision = await hostContext.onSpawn({ prompt: sharePrompt ? prompt : '(withheld: this workflow run does not share its script)', options: structuredClone(opts), workflow: Object.freeze({runId,agentIndex}), signal });
      if (decision?.deny) throw new Error(`Workflow agent spawn denied: ${decision.deny}`);
      if (sharePrompt && decision?.prompt !== undefined) {
        if (typeof decision.prompt !== 'string' || !decision.prompt.trim()) throw new TypeError('spawn hook prompt must be a non-empty string');
        prompt = decision.prompt;
      }
      if (decision?.model !== undefined) {
        if (typeof decision.model !== 'string' || !decision.model.trim()) throw new TypeError('spawn hook model must be a non-empty string');
        opts.model = inherited?.forcedModel ?? decision.model;
      }
    }
    const cacheOpts = Object.fromEntries(Object.entries(opts).filter(([key]) =>
      !['label', 'phase'].includes(key)));
    const branch = branches.getStore() ?? root;
    const key = createHash('sha256').update(`v1\0${branch.previousKey}\0${prompt}\0${JSON.stringify(canonical({ ...cacheOpts, provider: opts.provider ?? defaultProvider ?? null, hostContext: hostContext ? [hostContext.id, hostContext.revision] : null, cwd: resolve(cwd), executionContext: executionContext ?? null }))}`).digest('hex');
    branch.previousKey = key;
    const details={label:safeText(opts.label??prompt.split('\n')[0],160),phase:opts.phase??currentPhase,provider:opts.provider??defaultProvider??null,model:opts.model??null};
    if (branch.replaying && cached.has(key)) {await record({type:'cached',key,...details});return realmValue(cached.get(key));}
    branch.replaying = false;
    await record({type:'queued',key,...details});
    return inSlot(async () => {
      signal?.throwIfAborted();
      if (budget !== null && spent() >= budget) throw Error('Autocode token budget exceeded');
      const progress = { label: opts.label ?? prompt, phase: opts.phase ?? currentPhase };
      await record({ type: 'started', key, ...details });
      onProgress?.({ type: 'agent-started', ...progress });
      const usage={};
      let reportedOutput = 0;
      const reportOutput = count => {
        if (Number.isSafeInteger(count) && count > reportedOutput) {
          sharedBudget?.charge(count - reportedOutput);
          outputTokens += count - reportedOutput;
          reportedOutput = count;
        }
      };
      let isolatedPath, initialWorktreeHead, worktreeCreated = false, preserveWorktree = false;
      try {
        if (opts.isolation !== undefined && opts.isolation !== 'worktree') throw new TypeError('unsupported isolation');
        if (opts.isolation === 'worktree') {
          isolatedPath = resolve(runDir, 'worktrees', randomUUID());
          await mkdir(join(runDir, 'worktrees'), { recursive: true });
          await git(cwd, ['worktree', 'add', '--detach', isolatedPath, 'HEAD']);
          worktreeCreated = true;
          initialWorktreeHead = (await git(isolatedPath, ['rev-parse', 'HEAD'])).stdout.trim();
        }
        const response = await callAgent(prompt, opts, { signal, runDir, hostContext, agentIndex, cwd: isolatedPath ?? cwd, worktree: isolatedPath,
          onUsage:counts=>{reportOutput(counts?.outputTokens);for(const field of ['inputTokens','cachedInputTokens'])if(Number.isSafeInteger(counts?.[field])&&counts[field]>=0)usage[field]=counts[field];},
          onActivity:event=>{
            if(!event||typeof event.tool!=='string'||!['running','completed','failed'].includes(event.status))return;
            if(activityCount++>=1000){if(activityCount===1001)record({type:'activity-truncated',key});return;}
            record({type:'activity',key,tool:safeText(event.tool,100),status:event.status,id:safeText(event.id,160),exitCode:Number.isSafeInteger(event.exitCode)?event.exitCode:null,message:safeText(event.message)});
          },
        });
        if (!response || !Number.isSafeInteger(response.outputTokens) || response.outputTokens < 0)
          throw new TypeError('agent adapter must return a non-negative outputTokens count');
        reportOutput(response.outputTokens);
        usageIncomplete ||= response.usageIncomplete === true;
        const result = structuredClone(response.result);
        await record({ type: 'result', key, result });
        await record({type:'agent-finished',key,outputTokens:response.outputTokens,usageIncomplete:response.usageIncomplete === true,...usage});
        onProgress?.({ type: 'agent-completed', ...progress });
        return realmValue(result);
      } catch (error) {
        usageIncomplete = true;
        preserveWorktree = error?.code === 'cancellation-unconfirmed';
        await record({ type: error?.code === 'user-skip' ? 'skipped' : 'failed', key, outputTokens: reportedOutput, ...usage, message: safeText(error?.message ?? error) });
        onProgress?.({ type: error?.code === 'user-skip' ? 'agent-skipped' : 'agent-failed', ...progress });
        if (error?.code === 'user-skip') return null;
        if (['terminal-api','transient-api','api-error','rate-limit'].includes(error?.kind)) { failures.push(safeText(error.message)); return null; }
        throw error;
      } finally {
        if (worktreeCreated) {
          const { stdout } = await git(isolatedPath, ['status', '--porcelain', '--untracked-files=all', '--ignored']);
          const head = (await git(isolatedPath, ['rev-parse', 'HEAD'])).stdout.trim();
          if (!preserveWorktree && !stdout.trim() && head === initialWorktreeHead) await git(cwd, ['worktree', 'remove', isolatedPath]);
          else { worktrees.push({ path: isolatedPath }); await record({ type: 'worktree-preserved', path: isolatedPath }); }
        }
      }
    });
  };
  const parallel = async (thunks) => {
    if (!Array.isArray(thunks) || thunks.length > 4096 || thunks.some((fn) => typeof fn !== 'function'))
      throw new TypeError('parallel expects at most 4096 functions');
    const parent = branches.getStore() ?? root;
    const fork = parent.previousKey;
    parent.previousKey = `${fork}:parallel:fork`;
    const slots = thunks.map((_, index) => ({ previousKey: `${fork}:parallel:${index}`, replaying: parent.replaying }));
    const settled = await Promise.allSettled(thunks.map((fn, index) =>
      branches.run(slots[index], () => Promise.resolve().then(fn))));
    parent.replaying = parent.replaying && slots.every(slot => slot.replaying);
    parent.previousKey = createHash('sha256').update(JSON.stringify([parent.previousKey, slots.map(slot => slot.previousKey)])).digest('hex');
    return realmValue(settled.map((item, index) => {
      if (item.status === 'fulfilled') return item.value;
      failures.push(`parallel[${index}]: ${item.reason?.message ?? String(item.reason)}`);
      return null;
    }));
  };
  const pipeline = async (items, ...stages) => {
    if (!Array.isArray(items) || items.length > 4096 || stages.some((fn) => typeof fn !== 'function'))
      throw new TypeError('pipeline expects at most 4096 items and function stages');
    const parent = branches.getStore() ?? root;
    const fork = parent.previousKey;
    parent.previousKey = `${fork}:pipeline:fork`;
    const slots = items.map((_, index) => ({ previousKey: `${fork}:pipeline:${index}`, replaying: parent.replaying }));
    const settled = await Promise.allSettled(items.map((item, index) => branches.run(
      slots[index], async () => {
      let value = item;
      for (const stage of stages) {
        if (value === null) break;
        value = await stage(value, item, index);
      }
      return value;
    })));
    parent.replaying = parent.replaying && slots.every(slot => slot.replaying);
    parent.previousKey = createHash('sha256').update(JSON.stringify([parent.previousKey, slots.map(slot => slot.previousKey)])).digest('hex');
    return realmValue(settled.map((entry, index) => {
      if (entry.status === 'fulfilled') return entry.value;
      failures.push(`pipeline[${index}]: ${entry.reason?.message ?? String(entry.reason)}`);
      return null;
    }));
  };
  const phase = (title) => {
    if (typeof title !== 'string' || !title.trim()) throw new TypeError('phase title must be non-empty');
    currentPhase = title;
    record({ type: 'phase', title });
    onProgress?.({ type: 'phase', title });
  };
  const log = (message) => {
    if (logs.length < 1000) {
      const entry = { phase: currentPhase, message: String(message) };
      logs.push(entry);
      record({ type: 'log', ...entry });
      onProgress?.({ type: 'log', ...entry });
    }
  };
  const budgetView = Object.freeze(Object.assign(Object.create(null), {
    total: budget,
    spent,
    remaining: () => budget === null ? Infinity : Math.max(0, budget - spent()),
  }));
  const timers = new Map();
  let timerId = 0;
  const timer = (fn, delay) => {
    const id = ++timerId;
    timers.set(id, setTimeout(() => { timers.delete(id); fn(); }, delay));
    return id;
  };
  const cancelTimer = (id) => { clearTimeout(timers.get(id)); timers.delete(id); };
  for (const fn of [invokeAgent, parallel, pipeline, phase, log, timer, cancelTimer,
    budgetView.spent, budgetView.remaining]) Object.setPrototypeOf(fn, null);
  const execute = async (source, inputArgs, depth) => {
    const { meta: childMeta, body } = parseHeader(source);
    if (typeof childMeta.name !== 'string' || typeof childMeta.description !== 'string')
      throw new TypeError('child workflow needs name and description');
    const workflow = async (reference, childArgs) => {
      if (depth >= 1) throw new Error('child workflow depth limit reached');
      if (hostContext?.namedWorkflowsOnly && typeof reference !== 'string') throw new Error('host permits named workflows only');
      if (typeof reference === 'string' ? !/^[a-zA-Z0-9_-]+$/.test(reference) :
          !reference || typeof reference !== 'object' ||
          typeof reference.scriptPath !== 'string' || !reference.scriptPath.trim() ||
          Object.keys(reference).length !== 1)
        throw new TypeError('workflow reference must be a saved name or {scriptPath}');
      const registered = typeof reference === 'string' && Object.hasOwn(hostContext?.workflows ?? {}, reference);
      if (hostContext?.namedWorkflowsOnly && !registered) throw new Error('named workflow is not in the host registry');
      if (!registered && typeof resolveWorkflow !== 'function') throw new Error('named workflow resolver is unavailable');
      const childSource = registered ? hostContext.workflows[reference] : await resolveWorkflow(reference);
      const parent = branches.getStore() ?? root;
      const child = { previousKey: `${parent.previousKey}:workflow:${JSON.stringify(canonical(reference))}:${JSON.stringify(canonical(childArgs))}`, replaying: parent.replaying };
      const result = await branches.run(child, () => execute(childSource, childArgs, depth + 1));
      parent.previousKey = child.previousKey;
      parent.replaying = child.replaying;
      return realmValue(result);
    };
    Object.setPrototypeOf(workflow, null);
    const localPhase = depth === 0 ? phase : Object.setPrototypeOf(() => {}, null);
    const localAgent = depth === 0 ? invokeAgent : Object.setPrototypeOf((prompt, opts = {}) => invokeAgent(prompt, { ...opts, phase: `workflow ${childMeta.name}` }), null);
    const consoleOutput = Object.fromEntries(['log', 'info', 'debug', 'warn', 'error'].map(level => [level,
      Object.setPrototypeOf((...values) => log((['warn', 'error'].includes(level) ? `[${level}] ` : '') + values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ')), null)]));
    Object.setPrototypeOf(consoleOutput, null);
    const context = createContext({ console: consoleOutput, argsJson: inputArgs === undefined ? undefined : JSON.stringify(inputArgs),
      __autocodeHost: { agent: localAgent, parallel, pipeline, workflow },
      phase: localPhase, log, budget: budgetView, setTimeout: timer, clearTimeout: cancelTimer },
      { codeGeneration: { strings: false, wasm: false } });
    new Script(`(function(){
      const host=globalThis.__autocodeHost;
      delete globalThis.__autocodeHost;
      globalThis.agent=(...xs)=>Promise.resolve(host.agent(...xs));
      globalThis.parallel=(...xs)=>Promise.resolve(host.parallel(...xs));
      globalThis.pipeline=(...xs)=>Promise.resolve(host.pipeline(...xs));
      globalThis.workflow=(...xs)=>Promise.resolve(host.workflow(...xs));
      const NativeDate=Date;
      globalThis.Date=class extends NativeDate {
        constructor(...xs){if(xs.length===0)throw Error('Date.now and new Date() are unavailable in Autocode workflows');super(...xs)}
        static now(){throw Error('Date.now is unavailable in Autocode workflows')}
      };
      Math.random=()=>{throw Error('Math.random is unavailable in Autocode workflows')};
    })()`).runInContext(context);
    const code = new Script(`(async()=>{'use strict';const args=argsJson===undefined?undefined:JSON.parse(argsJson);\n${body}\n})()`, {
      filename: `${childMeta.name}.js`,
    });
    return contexts.run(context, () => code.runInContext(context, { timeout: 30_000 }));
  };
  try {
    signal?.throwIfAborted();
    const result = await execute(script, args, 0);
    signal?.throwIfAborted();
    const output = { result: structuredClone(result), agentCount, outputTokens: outputTokens - previousOutputTokens, failures, logs, runId, worktrees, ...(usageIncomplete ? {usageIncomplete:true} : {}) };
    try { await hostContext?.onComplete?.(structuredClone(output)); }
    catch(error) {
      const message = `Completion notification failed: ${safeText(error?.message ?? error)}`;
      failures.push(message); await record({type:'notification-failed',message});
    }
    await record({type:'run-finished',failures:failures.map(x=>safeText(x))});
    return output;
  } catch(error) {
    await record({type:'run-failed',message:safeText(error?.message??error)});
    try { await hostContext?.onFailure?.({runId,error:safeText(error?.message??error)}); }
    catch(notificationError) { await record({type:'notification-failed',message:safeText(notificationError?.message??notificationError)}); }
    throw error;
  } finally {unsubscribeControls?.();for(const id of timers.keys())cancelTimer(id);await journalQueue;}
}
