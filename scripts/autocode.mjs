#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { runWorkflow, workflowMetadata, exportWorkflowJournal, importWorkflowJournal } from './runtime.mjs';
import { codexAgent } from './codex-adapter.mjs';
import { claudeAgent } from './claude-adapter.mjs';
import { readRunStatus, formatStatus, safeText, projectRunRegistry } from './run-stats.mjs';
import { controlRun, superviseRun } from './run-control.mjs';

function parseRun(argv) {
  if (argv[0] !== 'run' || !argv[1] || argv[1].startsWith('--'))
    throw new Error('usage: autocode run <script.js> [--provider codex|claude] [options]');
  const scriptPath = resolve(argv[1]);
  const flags = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--background') throw new Error('Unattended --background has no parent completion delivery. Await the foreground CLI or run it inside a host-native background task that delivers success and failure.');
    if (!argv[i]?.startsWith('--') || argv[i + 1] === undefined) throw new Error(`invalid option: ${argv[i]}`);
    const name = argv[i].slice(2);
    flags[name] = argv[++i];
  }
  for (const name of Object.keys(flags))
    if (!['args', 'run-dir', 'resume', 'budget', 'sandbox', 'codex', 'claude', 'provider', 'cwd', 'context'].includes(name))
      throw new Error(`unknown option: --${name}`);
  const provider = flags.provider ?? 'codex';
  if (!['codex', 'claude'].includes(provider)) throw new Error(`unknown provider: ${provider}`);
  const cwd = resolve(flags.cwd ?? process.cwd());
  const worker = process.env.AUTOCODE_WORKER === '1' && process.send && process.connected;
  const runId = flags.resume ?? process.env.AUTOCODE_LAUNCH_ID ?? (worker ? process.env.AUTOCODE_RUN_ID || undefined : undefined) ?? `wf_${randomUUID()}`;
  const runDir = flags['run-dir'] ? resolve(flags['run-dir']) : join(cwd, '.autocode/runs', runId);
  const args = flags.args === undefined ? undefined : JSON.parse(flags.args);
  const budget = flags.budget === undefined ? null : Number(flags.budget);
  const sandbox = flags.sandbox ?? 'read-only';
  return {scriptPath,flags,provider,cwd,runDir,runId,args,budget,sandbox};
}

const terminal = new Set(['completed','failed','cancelled','interrupted']);
async function projectRuns() {
  const project=realpathSync(process.cwd());
  const directories=new Map(),unreadable=[];
  for (const root of [join(project,'.autocode/runs'),join(project,'.codex/autocode-runs'),projectRunRegistry(project)]) {
  const entries=await readdir(root,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];if(error.code==='EACCES'&&root!==projectRunRegistry(project)){unreadable.push(root);return [];}throw error;});
  for(const entry of entries) {
    if(entry.isDirectory()){
      const directory=realpathSync(join(root,entry.name));
      const owner=await readFile(join(directory,'control.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return {};throw error;});
      if(!owner.project||owner.project===project)if(!directories.has(directory))directories.set(directory,null);
    }
    else if(entry.isFile()&&/^wf_[0-9a-f-]{36}\.json$/i.test(entry.name)) {
      const ref=JSON.parse(await readFile(join(root,entry.name),'utf8'));
      if(ref.project!==project||typeof ref.runDir!=='string')throw Error('invalid project workflow registration');
      let directory;try{directory=realpathSync(ref.runDir);}catch(error){if(error.code==='ENOENT')continue;throw error;}
      const id=entry.name.slice(0,-5);
      let embeddedOwner=false;
      const owner=await readFile(join(directory,'control.json'),'utf8').catch(error=>{
        if(error.code!=='ENOENT')throw error;
        embeddedOwner=true;return readFile(join(directory,'runner.json'),'utf8');
      }).then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(!owner)continue;
      if(embeddedOwner&&owner.project!==project)continue;
      if(owner.project!==project||owner.runId!==id)throw Error('project workflow registration does not match its owner');
      directories.set(directory,id);
    }
  }
  }
  const runs=[];
  for(const [directory,id] of directories) {
    try {const run=await readRunStatus(directory);if(id&&run.runId!==id)throw Error('workflow ID does not match its registration');runs.push(run);}
    catch(error){if(error.code==='ENOENT'&&!id)continue;throw error;}
  }
  if(unreadable.length){
    const message=`Cannot inspect workflow registry: ${unreadable.map(path=>safeText(path)).join(', ')}`;
    if(!runs.length)throw Error(message);
    runs.discoveryError=message;
    process.stderr.write(`Warning: ${message}; showing discoverable runs.\n`);
  }
  return runs.sort((a,b)=>String(a.runId).localeCompare(String(b.runId)));
}

function formatRuns(runs) {
  if(!runs.length)return 'No active Autocode workflows in this project.';
  return ['ID | Workflow | State | Phase | Agents | Output tokens | Errors | Controls',...runs.map(run=>
    `${safeText(run.runId??'unknown')} | ${run.name} | ${safeText(run.state)} | ${run.phase||'—'} | ${run.agentCount} | ${run.outputTokens} | ${run.errorCount} | ${run.controllable===true?'CLI':run.controllable===false?'host':'unknown'}${run.error?`\n  Error: ${run.error}`:''}`)].join('\n');
}
function formatSelection(result) {return `${formatRuns(result.workflows)}\n${result.question}`;}

export async function runAutocode(argv, adapters = { codex: codexAgent, claude: claudeAgent }) {
  if (['export','import'].includes(argv[0])) {
    const flags = {};
    for (let index = 1; index < argv.length; index += 2) {
      if (!['--run-dir','--to','--from'].includes(argv[index]) || argv[index + 1] === undefined) throw new Error('journal transfer needs --run-dir and --to or --from');
      flags[argv[index].slice(2)] = argv[index + 1];
    }
    if (!flags['run-dir'] || (argv[0] === 'export' ? !flags.to || flags.from : !flags.from || flags.to)) throw new Error('journal transfer needs --run-dir and --to or --from');
    return argv[0] === 'export' ? exportWorkflowJournal(flags['run-dir'], flags.to) : importWorkflowJournal(flags.from, flags['run-dir']);
  }
  if (argv[0] === 'workflows') {
    let cwd = process.cwd(), contextFile, json = false;
    for (let index = 1; index < argv.length; index++) {
      if (argv[index] === '--json') json = true;
      else if (argv[index] === '--cwd' && argv[index + 1]) cwd = resolve(argv[++index]);
      else if (argv[index] === '--context' && argv[index + 1]) contextFile = resolve(argv[++index]);
      else throw new Error(`unknown workflow discovery option: ${argv[index]}`);
    }
    const context = contextFile ? JSON.parse(await readFile(contextFile, 'utf8')) : {};
    const catalog = new Map(Object.entries(context.workflows ?? {}).map(([reference, source]) => [reference, { source }]));
    if (!context.namedWorkflowsOnly) {
      const directory = join(cwd, '.codex', 'workflows');
      const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      for (const entry of entries) if (entry.isFile() && entry.name.endsWith('.js')) {
        const reference = entry.name.slice(0, -3);
        if (!catalog.has(reference)) {
          const scriptPath = join(directory, entry.name);
          catalog.set(reference, { source: await readFile(scriptPath, 'utf8'), scriptPath });
        }
      }
    }
    const entries = [...catalog.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([reference, { source, scriptPath }]) => ({ ...workflowMetadata(source), reference, ...(scriptPath ? { scriptPath } : {}) }));
    return json ? entries : entries.map(entry => `${entry.reference}: ${entry.name} — ${entry.description}${entry.whenToUse ? ` (${entry.whenToUse})` : ''}`).join('\n');
  }
  if(['ps','status','pause','resume','cancel','skip','retry'].includes(argv[0])) {
    const flags={};
    for(let i=1;i<argv.length;i++) {
      if(argv[i]==='--json')flags.json=true;
      else if(argv[i]==='--run-dir'&&argv[i+1])flags.directory=argv[++i];
      else if(argv[i]==='--agent'&&/^[1-9][0-9]*$/.test(argv[i+1]??''))flags.agent=Number(argv[++i]);
      else if(!argv[i].startsWith('-')&&!flags.id)flags.id=argv[i];
      else throw Error(`unknown workflow control option: ${argv[i]}`);
    }
    if(flags.id&&flags.directory)throw Error('choose a workflow ID or --run-dir, not both');
    if(argv[0]==='ps') {
      if(flags.id||flags.directory||flags.agent)throw Error('usage: autocode ps [--json]');
      const discovered=await projectRuns(),runs=discovered.filter(run=>!terminal.has(run.state));
      if(!runs.length&&discovered.discoveryError)throw Error(discovered.discoveryError);
      return flags.json?runs:formatRuns(runs);
    }
    if (['skip','retry'].includes(argv[0]) && !flags.agent) throw Error('agent controls require --agent <id>');
    if(flags.agent&&!['status','skip','retry'].includes(argv[0]))throw Error('--agent is only available for status; controls apply to the entire workflow');
    if(!flags.directory) {
      const runs=await projectRuns();
      if(!flags.id&&runs.discoveryError)throw Error(runs.discoveryError);
      const candidates=flags.id?runs.filter(run=>run.runId===flags.id):runs.filter(run=>!terminal.has(run.state));
      if(flags.id&&!candidates.length)throw Error(`workflow ID not found in this project: ${safeText(flags.id)}`);
      if(!candidates.length)return flags.json?{state:'idle',workflows:[]}:formatRuns([]);
      if(candidates.length>1)return {state:'selection-required',command:argv[0],workflows:candidates,
        question:`Which workflow should ${argv[0]} manage? Choose an ID: autocode ${argv[0]} <id>`};
      flags.directory=candidates[0].runDir;
    }
    if(argv[0]!=='status'){
      const result=await controlRun(flags.directory,argv[0],{agent:flags.agent});
      return flags.json?result:`${result.state}: ${safeText(result.runId??result.runDir)}${result.persistenceError?` (state save failed: ${result.persistenceError})`:''}`;
    }
    const result=await readRunStatus(flags.directory);
    if(flags.agent){result.agents=result.agents.filter(call=>call.id===flags.agent);if(!result.agents.length)throw Error('agent row is not in the retained view; inspect journal.jsonl');}
    return flags.json?result:formatStatus(result);
  }
  const {scriptPath,flags,provider,cwd,runDir,runId,args,budget,sandbox}=parseRun(argv);
  const result = await runWorkflow({
    script: await readFile(scriptPath, 'utf8'), args, runDir, budget,
    defaultProvider:provider, cwd,
    executionContext: { sandbox, codex: flags.codex ?? null, claude: flags.claude ?? null },
    hostContext: flags.context ? JSON.parse(await readFile(resolve(flags.context), 'utf8')) : undefined,
    subscribeControls: process.send ? handler => {
      const listener = message => {
        if (message?.type !== 'agent-control') return;
        try { handler(message); process.send?.({type:'agent-control-result',requestId:message.requestId}); }
        catch(error) { process.send?.({type:'agent-control-result',requestId:message.requestId,error:safeText(error.message)}); }
      };
      process.on('message', listener);
      return () => process.removeListener('message', listener);
    } : undefined,
    initialRunId:runId,
    resumeFromRunId: flags.resume,
    onProgress: (event) => process.stderr.write(event.type === 'phase' ?
      `${event.title}\n` : event.type === 'log' ? `${event.message}\n` :
      `${event.phase ? `[${event.phase}] ` : ''}${event.label}: ${event.type.slice(6)}\n`),
    resolveWorkflow: (reference) => readFile(typeof reference === 'string' ?
      join(cwd, '.codex', 'workflows', `${reference}.js`) : resolve(cwd, reference.scriptPath), 'utf8'),
    agent: (prompt, opts, context) => {
      const selected = opts.provider ?? provider;
      if (!['codex', 'claude'].includes(selected)) throw new Error(`unknown provider: ${selected}`);
      return adapters[selected](prompt, { ...opts, sandbox }, {
        ...context, cwd:context.cwd??cwd, executable: selected === 'codex' ? flags.codex : flags.claude,
      });
    },
  });
  return { ...result, runDir };
}

if (process.argv[1] && existsSync(process.argv[1]) &&
    realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv=process.argv.slice(2);
  const main=async()=>{
    const worker=process.env.AUTOCODE_WORKER==='1'&&!!process.send&&process.connected;
    if(argv[0]==='run'&&!worker&&process.platform==='linux'){
      const {runDir,runId,provider,cwd}=parseRun(argv);
      const workerArgs=[...argv,'--run-dir',runDir];
      const command=[process.execPath,fileURLToPath(import.meta.url),...workerArgs];
      const result=await superviseRun(command,{runDir,runId,project:cwd,provider});process.exitCode=result.state==='cancelled'?130:result.exitCode??1;
      return;
    }
    const guardianLost=()=>{try{process.kill(-process.pid,'SIGKILL');}catch{}};
    if(worker)process.once('disconnect',guardianLost);
    try{
      let result=await runAutocode(argv);
      if(result.state==='selection-required'&&!argv.includes('--json')&&process.stdin.isTTY&&process.stdout.isTTY){
        process.stdout.write(`${formatRuns(result.workflows)}\n`);
        const prompt=createInterface({input:process.stdin,output:process.stdout});
        try{const id=(await prompt.question(`${result.question}\nID: `)).trim();if(!id)throw Error('no workflow selected');result=await runAutocode([argv[0],id,...argv.slice(1)]);}finally{prompt.close();}
      }
      process.stdout.write(`${typeof result==='string'?result:result.state==='selection-required'&&!argv.includes('--json')?formatSelection(result):JSON.stringify(result)}\n`);
    }finally{if(worker){process.removeListener('disconnect',guardianLost);if(process.connected)process.disconnect();}}
  };
  main().catch(error=>{process.stderr.write(`autocode: ${error.message}\n`);process.exitCode=1;});
}
