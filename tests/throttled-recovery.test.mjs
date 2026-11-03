import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setImmediate as immediate} from 'node:timers/promises';
import {runWorkflow} from '../scripts/runtime.mjs';
test('a slow low-token response without a stop reason waits 45 seconds and retries once',async t=>{
 const runDir=await mkdtemp(join(tmpdir(),'throttle-recovery-'));let calls=0,settled=false;
 const controller=new AbortController();let pending;
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  pending=runWorkflow({runDir,signal:controller.signal,script:'export const meta={name:"throttle",description:"throttle"};return agent("request");',agent:async()=>({result:++calls===1?'degraded':'recovered',outputTokens:2,durationMs:100000})});
  pending.then(()=>settled=true,()=>settled=true);
  const deadline=performance.now()+5000;let waiting=false;
  while(!settled&&performance.now()<deadline){
   const journal=await readFile(join(runDir,'journal.jsonl'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
   if(journal.includes('waiting 45 seconds')){waiting=true;break;}
   await immediate();
  }
  assert.equal(waiting,true,'recovery must reach backoff before advancing its clock');
  await immediate();
  assert.equal(settled,false,'degraded response must wait before returning');
  t.mock.timers.tick(44999);await immediate();assert.equal(calls,1);
  t.mock.timers.tick(1);
  const result=await pending;
  assert.equal(result.result,'recovered');assert.equal(calls,2);assert.equal(result.outputTokens,4);
 }finally{controller.abort(Error('test cleanup'));await pending?.catch(()=>{});t.mock.timers.reset();await rm(runDir,{recursive:true,force:true});}
});

test('terminal and unmeasured responses do not enter throttle backoff',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'throttle-terminal-'));let calls=0;
 try{
  const result=await runWorkflow({runDir,script:'export const meta={name:"terminal",description:"terminal"};return [await agent("terminal"),await agent("unmeasured")];',agent:async prompt=>{calls++;return prompt==='terminal'?{result:'done',outputTokens:1,durationMs:100000,stopReason:'end_turn'}:{result:'ordinary',outputTokens:1};}});
  assert.deepEqual(result.result,['done','ordinary']);assert.equal(calls,2);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('a throttle retry does not start the separate stalled-response retry loop',async t=>{
 const runDir=await mkdtemp(join(tmpdir(),'throttle-stall-'));let calls=0;
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  const pending=runWorkflow({runDir,script:'export const meta={name:"throttle",description:"throttle"};return agent("request");',agent:async()=>{calls++;if(calls===1)return {result:'degraded',outputTokens:1,durationMs:100000};if(calls===2)return {stalled:true,outputTokens:1};return {result:'extra retry',outputTokens:1};}});
  const observed=pending.then(()=>null,error=>error);
  for(let i=0;i<1000&&calls===0;i++)await immediate();for(let i=0;i<1000;i++){if((await readFile(join(runDir,'journal.jsonl'),'utf8')).includes('waiting 45 seconds'))break;await immediate();}
  await immediate();
  t.mock.timers.tick(45000);
  const error=await observed;assert.match(error?.message??'',/stalled/);assert.equal(calls,2);
 }finally{t.mock.timers.reset();await rm(runDir,{recursive:true,force:true});}
});

test('valid structured responses never enter degraded text backoff',async t=>{
 const runDir=await mkdtemp(join(tmpdir(),'throttle-structured-'));let calls=0,settled=false;
 t.mock.timers.enable({apis:['setTimeout']});
 const pending=runWorkflow({runDir,script:'export const meta={name:"structured",description:"structured"};return agent("request",{schema:{type:"object",properties:{answer:{type:"integer"}},required:["answer"]}});',agent:async()=>{calls++;return {result:{answer:42},outputTokens:2,durationMs:100000,stopReason:null};}});
 pending.finally(()=>{settled=true;});
 try{
  const deadline=performance.now()+2000;
  while(!settled&&performance.now()<deadline)await immediate();
  assert.equal(settled,true,'structured output must bypass degraded text backoff');
  assert.deepEqual((await pending).result,{answer:42});assert.equal(calls,1);
 }finally{t.mock.timers.tick(45000);await pending;t.mock.timers.reset();await rm(runDir,{recursive:true,force:true});}
});
