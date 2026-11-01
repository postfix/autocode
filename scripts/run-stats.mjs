import {createReadStream} from 'node:fs';
import {readFile, stat} from 'node:fs/promises';
import {join, resolve, basename} from 'node:path';

export function safeText(value, limit=2000) {
  return String(value??'').slice(-8192)
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]/g,'')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'')
    .replace(/\bBearer\s+[^\s"']+/gi,'Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|authorization|password|access[_-]?token)["']?\s*[:=]\s*["']?[^\s"',;]+/gi,'$1=[REDACTED]')
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}/g,'[REDACTED]').slice(-limit);
}

// Results can be large; statistics never retain or parse oversized result records.
async function* records(file, issues) {
  let pending='', skipping=false;
  try {
    for await (const chunk of createReadStream(file,{encoding:'utf8',highWaterMark:65536})) {
      for(const part of chunk.match(/[^\n]*\n|[^\n]+$/g)??[]) {
        const end=part.endsWith('\n');
        if(!skipping)pending+=part;
        if(pending.length>1024*1024){pending='';skipping=true;issues.skippedRecords++;}
        if(end){
          if(!skipping&&pending.trim())try{yield JSON.parse(pending);}catch{issues.malformedRecords++;}
          pending='';skipping=false;
        }
      }
    }
    if(pending.trim())issues.partialRecord=true;
  }catch(error){if(error.code!=='ENOENT')throw error;}
}

export async function readRunStatus(directory) {
  const runDir=resolve(directory), metaFile=join(runDir,'run.json');
  let meta;
  try{if((await stat(metaFile)).size>8*1024*1024)throw Error('run metadata exceeds the statistics size limit');meta=JSON.parse(await readFile(metaFile,'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;await readFile(join(runDir,'control.json'),'utf8');meta={name:basename(runDir),runId:null};}
  const result={runDir,runId:meta.runId,name:safeText(meta.name,160),state:'unknown',phase:null,phases:[],agents:[],outputTokens:0,inputTokens:null,cachedInputTokens:null,errorCount:0,error:null,activityTruncated:false,skippedRecords:0,malformedRecords:0};
  const agents=new Map();let startedAt=null,endedAt=null,totalAgents=0;
  for await(const event of records(join(runDir,'journal.jsonl'),result)) {
    if(event.type==='run-started'){
      for(const call of agents.values())if(['queued','running'].includes(call.state)){call.state='interrupted';call.endedAt=event.time;}
      result.state='running';startedAt??=event.time;endedAt=null;result.attemptId=event.attemptId;result.concurrency=event.concurrency;result.phases=event.phases??[];
    }
    if(event.type==='phase'){result.phase=safeText(event.title,160);if(!result.phases.some(p=>p.title===result.phase))result.phases.push({title:result.phase});}
    if(event.type==='run-finished'){result.state='completed';endedAt=event.time;result.failures=(event.failures??[]).map(x=>safeText(x));}
    if(event.type==='run-failed'){result.state='failed';endedAt=event.time;result.error=safeText(event.message);result.errorCount++;}
    if(!event.key)continue;
    const id=`${event.attemptId??'legacy'}:${event.key}`;
    if(['queued','started','cached'].includes(event.type)) {
      if(!agents.has(id)){
        if(agents.size>=1000)agents.delete(agents.keys().next().value);
        agents.set(id,{id:++totalAgents,key:event.key,attemptId:event.attemptId,label:safeText(event.label??event.key,160),phase:safeText(event.phase,160),provider:event.provider?safeText(event.provider,100):null,model:event.model?safeText(event.model,160):null,state:'queued',queuedAt:event.time??null,startedAt:null,endedAt:null,outputTokens:null,activity:[]});
      }
      if(event.type!=='queued')Object.assign(agents.get(id),{state:event.type==='cached'?'cached':'running',startedAt:event.time??null,endedAt:event.type==='cached'?event.time:null,outputTokens:event.type==='cached'?0:null});
    }
    const call=agents.get(id);
    if(event.type==='agent-finished') {
      result.outputTokens+=event.outputTokens;
      for(const field of ['inputTokens','cachedInputTokens'])if(Number.isSafeInteger(event[field]))result[field]=(result[field]??0)+event[field];
      if(call)Object.assign(call,{state:'completed',endedAt:event.time,outputTokens:event.outputTokens,inputTokens:event.inputTokens??null,cachedInputTokens:event.cachedInputTokens??null});
    }
    if(event.type==='failed'){result.errorCount++;result.usageIncomplete=true;if(call)Object.assign(call,{state:'failed',endedAt:event.time,error:safeText(event.message)});}
    if(event.type==='activity') {
      if(event.status==='failed')result.errorCount++;
      if(call){const entry={tool:safeText(event.tool,100),status:event.status,exitCode:event.exitCode??null,message:safeText(event.message),time:event.time};const old=event.id?call.activity.findIndex(x=>x.id===event.id):-1;if(event.id)entry.id=event.id;if(old>=0)call.activity[old]=entry;else call.activity.push(entry);call.activity=call.activity.slice(-20);}
    }
    if(event.type==='activity-truncated')result.activityTruncated=true;
  }
  try {
    const saved=JSON.parse(await readFile(join(runDir,'control.json'),'utf8'));
    let control=saved;
    if(['starting','running','paused','cancelling'].includes(saved.state)) {
      try{control=await (await import('./run-control.mjs')).controlRun(runDir,'status');}catch{control={...saved,state:'unavailable'};}
    }
    Object.assign(result,{state:control.state,pid:control.childPid,exitCode:control.exitCode??null,signal:control.signal??null});
    result.runId??=control.runId??null;
    if(control.error)result.error=safeText(control.error);
    if(control.controlError)result.controlError=safeText(control.controlError);
    if(control.persistenceError){result.persistenceError=safeText(control.persistenceError);result.statisticsIncomplete=true;}
    startedAt??=control.startedAt;endedAt=control.endedAt??endedAt;
    for(const call of agents.values())call.provider??=control.provider??null;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  result.elapsedMs=startedAt?Math.max(0,(endedAt??Date.now())-startedAt):null;
  result.agentCount=totalAgents;
  if(result.state==='cancelled')for(const call of agents.values())if(['running','queued'].includes(call.state))call.state='cancelled';
  if([...agents.values()].some(call=>call.state==='running'||call.state==='queued'))result.usageIncomplete=true;
  result.agents=[...agents.values()].map(call=>({...call,elapsedMs:call.startedAt?Math.max(0,(call.endedAt??endedAt??Date.now())-call.startedAt):null}));
  if(result.malformedRecords||result.partialRecord)result.statisticsIncomplete=true;
  return result;
}

export function formatStatus(run) {
  const duration=ms=>ms===null?'?':`${Math.floor(ms/1000)}s`;
  const rows=[`${run.name} — ${safeText(run.state)} (${safeText(run.runId??'not started')})`,`Elapsed ${duration(run.elapsedMs)} · output ${run.outputTokens} tokens · input ${run.inputTokens??'unknown'} · cached input ${run.cachedInputTokens??'unknown'} · recorded errors ${run.errorCount}`,`Run directory: ${safeText(run.runDir)}`];
  if(run.phase)rows.push(`Phase: ${run.phase}`);
  if(run.phases.length)rows.push(`Phases: ${run.phases.map(p=>safeText(p.title,160)).join(' → ')}`);
  if(run.error)rows.push(`Error: ${run.error}`);
  if(run.controlError)rows.push(`Control error: ${run.controlError}`);
  if(run.persistenceError)rows.push(`State save failed: ${run.persistenceError}`);
  for(const failure of run.failures??[])rows.push(`Branch failure: ${failure}`);
  rows.push('Agent | Phase | Provider / requested model | State | Elapsed | Output tokens');
  for(const call of run.agents.slice(-20)){rows.push(`${call.id}: ${call.label} | ${call.phase||'—'} | ${call.provider??'unknown'} / ${call.model??'default'} | ${call.state} | ${duration(call.elapsedMs)} | ${call.outputTokens??'unknown'}`);if(call.error)rows.push(`  Error: ${call.error}`);for(const entry of call.activity)rows.push(`  ${entry.tool}: ${entry.status}${entry.exitCode===null?'':` (exit ${entry.exitCode})`}${entry.message?`: ${entry.message}`:''}`);}
  if(run.agents.length>20)rows.push(`Showing the last 20 of ${run.agentCount} agent rows; select --agent <id> or --json for more.`);
  if(run.statisticsIncomplete||run.skippedRecords||run.activityTruncated)rows.push('Some journal/activity records are incomplete or omitted; see the retained journal.');
  if(run.usageIncomplete)rows.push('Token totals include reported completed calls across attempts; failed/in-flight usage may be unavailable.');
  return rows.join('\n');
}
