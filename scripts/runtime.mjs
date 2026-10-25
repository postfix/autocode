import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { Script, createContext } from 'node:vm';

function parseHeader(source) {
  const comment = /^\/\* autocode ([^\n]*?) \*\/[\r\n]+/.exec(source);
  if (comment) return { meta: JSON.parse(comment[1]), body: source.slice(comment[0].length) };
  const exported = /^export\s+const\s+meta\s*=\s*\{/.exec(source);
  if (!exported) throw new SyntaxError('workflow must start with JSON autocode metadata or export const meta');
  let depth = 0, quote = null, escaped = false, end = -1;
  for (let i = exported[0].length - 1; i < source.length && i < 65536; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { end = i + 1; break; }
  }
  if (end < 0) throw new SyntaxError('unterminated workflow metadata');
  const literal = source.slice(exported[0].length - 1, end);
  const meta = new Script(`(${literal})`).runInContext(createContext({},
    { codeGeneration: { strings: false, wasm: false } }), { timeout: 1000 });
  if (!meta || typeof meta !== 'object' || Array.isArray(meta))
    throw new TypeError('workflow metadata must be an object');
  return { meta, body: source.slice(end).replace(/^\s*;?/, '') };
}

export async function runWorkflow({ script, args, runDir, agent, budget = null, signal,
  concurrency = Math.min(16, Math.max(2, availableParallelism() - 2)), resumeFromRunId,
  resolveWorkflow, onProgress }) {
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
  if (resumeFromRunId) {
    const saved = JSON.parse(await readFile(runFile, 'utf8'));
    if (saved.runId !== resumeFromRunId) throw new Error('resume run ID does not match this directory');
    runId = saved.runId;
    const previous = await readFile(journalFile, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    for (const line of previous.split('\n')) {
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.type === 'result') cached.set(event.key, event.result);
    }
  } else {
    runId = `wf_${randomUUID()}`;
    await writeFile(runFile, JSON.stringify({ runId, name: meta.name, script, args }), { flag: 'wx' });
  }
  let journalQueue = Promise.resolve();
  const record = (event) => journalQueue = journalQueue.then(() =>
    appendFile(journalFile, `${JSON.stringify(event)}\n`));
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value;
  };
  const seed = createHash('sha256').update(args === undefined ? 'undefined' : JSON.stringify(canonical(args))).digest('hex');
  const branches = new AsyncLocalStorage();
  const root = { previousKey: seed };
  let agentCount = 0;
  let outputTokens = 0;
  let currentPhase = null;
  const logs = [];
  let active = 0;
  const waiting = [];
  const failures = [];
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
  const invokeAgent = async (prompt, opts = {}) => {
    if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('agent prompt must be a non-empty string');
    if (agentCount >= 1000) throw Error('Autocode agent call cap reached (1000)');
    agentCount++;
    const cacheOpts = Object.fromEntries(Object.entries(opts).filter(([key]) =>
      !['label', 'phase'].includes(key)));
    const branch = branches.getStore() ?? root;
    const key = createHash('sha256').update(`v1\0${branch.previousKey}\0${prompt}\0${JSON.stringify(canonical(cacheOpts))}`).digest('hex');
    branch.previousKey = key;
    if (cached.has(key)) return realmValue(cached.get(key));
    return inSlot(async () => {
      if (budget !== null && outputTokens >= budget) throw Error('Autocode token budget exceeded');
      const progress = { label: opts.label ?? prompt, phase: opts.phase ?? currentPhase };
      await record({ type: 'started', key });
      onProgress?.({ type: 'agent-started', ...progress });
      try {
        const response = await agent(prompt, opts, { signal, runDir });
        if (!response || !Number.isSafeInteger(response.outputTokens) || response.outputTokens < 0)
          throw new TypeError('agent adapter must return a non-negative outputTokens count');
        outputTokens += response.outputTokens;
        const result = structuredClone(response.result);
        await record({ type: 'result', key, result });
        onProgress?.({ type: 'agent-completed', ...progress });
        return realmValue(result);
      } catch (error) {
        await record({ type: 'failed', key, message: String(error?.message ?? error) });
        onProgress?.({ type: 'agent-failed', ...progress });
        throw error;
      }
    });
  };
  const parallel = async (thunks) => {
    if (!Array.isArray(thunks) || thunks.length > 4096 || thunks.some((fn) => typeof fn !== 'function'))
      throw new TypeError('parallel expects at most 4096 functions');
    const parent = branches.getStore() ?? root;
    const settled = await Promise.allSettled(thunks.map((fn, index) =>
      branches.run({ previousKey: `${parent.previousKey}:parallel:${index}` }, () => Promise.resolve().then(fn))));
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
    const settled = await Promise.allSettled(items.map((item, index) => branches.run(
      { previousKey: `${parent.previousKey}:pipeline:${index}` }, async () => {
      let value = item;
      for (const stage of stages) {
        if (value === null) break;
        value = await stage(value, item, index);
      }
      return value;
    })));
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
    spent: () => outputTokens,
    remaining: () => budget === null ? Infinity : Math.max(0, budget - outputTokens),
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
      if (typeof reference === 'string' ? !/^[a-zA-Z0-9_-]+$/.test(reference) :
          !reference || typeof reference !== 'object' ||
          typeof reference.scriptPath !== 'string' || !reference.scriptPath.trim() ||
          Object.keys(reference).length !== 1)
        throw new TypeError('workflow reference must be a saved name or {scriptPath}');
      if (typeof resolveWorkflow !== 'function') throw new Error('named workflow resolver is unavailable');
      const childSource = await resolveWorkflow(reference);
      const parent = branches.getStore() ?? root;
      const child = { previousKey: `${parent.previousKey}:workflow:${JSON.stringify(canonical(reference))}:${JSON.stringify(canonical(childArgs))}` };
      const result = await branches.run(child, () => execute(childSource, childArgs, depth + 1));
      parent.previousKey = child.previousKey;
      return realmValue(result);
    };
    Object.setPrototypeOf(workflow, null);
    const context = createContext({ argsJson: inputArgs === undefined ? undefined : JSON.stringify(inputArgs),
      __autocodeHost: { agent: invokeAgent, parallel, pipeline, workflow },
      phase, log, budget: budgetView, setTimeout: timer, clearTimeout: cancelTimer },
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
  const result = await execute(script, args, 0);
  await journalQueue;
  return { result: structuredClone(result), agentCount, outputTokens, failures, logs, runId };
}
