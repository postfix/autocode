import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {runWorkflow} from '../scripts/runtime.mjs';
const script='export const meta={name:"controls",description:"recovery controls"};return agent("task");';
async function until(fn){for(let i=0;i<300;i++){if(await fn())return;await delay(5);}throw Error('condition timed out');}

test('skip interrupts throttle backoff without starting another provider call',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'recovery-skip-')),controller=new AbortController();let dispatch,calls=0,settled=false;
 const pending=runWorkflow({runDir,script,signal:controller.signal,subscribeControls:handler=>{dispatch=handler;return()=>{};},agent:async()=>{calls++;return {result:'degraded',outputTokens:3,durationMs:100000};}});
 const observed=pending.then(result=>{settled=true;return {result};},error=>{settled=true;return {error};});
 try{
  await until(async()=>(await readFile(join(runDir,'journal.jsonl'),'utf8').catch(()=>'' )).includes('waiting 45 seconds'));
  dispatch({agent:1,command:'skip'});await Promise.race([observed,delay(500)]);
  assert.equal(settled,true,'skip must interrupt backoff immediately');
  const {result,error}=await observed;assert.equal(error,undefined);assert.equal(result.result,null);assert.equal(result.outputTokens,3);assert.equal(calls,1);
 }finally{controller.abort(Error('test cleanup'));await observed;await rm(runDir,{recursive:true,force:true});}
});

test('skip interrupts host quota waiting using the agent cancellation signal',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'recovery-quota-')),controller=new AbortController();let dispatch,waiting=false,settled=false,calls=0;
 const pending=runWorkflow({runDir,script,signal:controller.signal,hostContext:{id:'quota',revision:'1',waitForQuota:({signal})=>new Promise((resolve,reject)=>{waiting=true;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})},subscribeControls:handler=>{dispatch=handler;return()=>{};},agent:async()=>{calls++;throw Object.assign(Error('rate limited'),{kind:'rate-limit'});}});
 const observed=pending.then(result=>{settled=true;return {result};},error=>{settled=true;return {error};});
 try{
  await until(()=>waiting);dispatch({agent:1,command:'skip'});await Promise.race([observed,delay(500)]);
  assert.equal(settled,true,'skip must interrupt quota wait immediately');
  const {result,error}=await observed;assert.equal(error,undefined);assert.equal(result.result,null);assert.equal(calls,1);
 }finally{controller.abort(Error('test cleanup'));await observed;await rm(runDir,{recursive:true,force:true});}
});

test('manual retry interrupts backoff and sums measured usage across attempts exactly once',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'recovery-retry-')),controller=new AbortController();let dispatch,calls=0;
 const pending=runWorkflow({runDir,script,signal:controller.signal,subscribeControls:handler=>{dispatch=handler;return()=>{};},agent:async(_prompt,_opts,context)=>{calls++;context.onUsage({outputTokens:calls===1?3:5,inputTokens:calls===1?11:13,cachedInputTokens:calls===1?2:3});return calls===1?{result:'degraded',outputTokens:3,durationMs:100000}:{result:'recovered',outputTokens:5};}});
 try{
  await until(async()=>(await readFile(join(runDir,'journal.jsonl'),'utf8').catch(()=>'' )).includes('waiting 45 seconds'));
  dispatch({agent:1,command:'retry'});const result=await pending;
  assert.equal(result.result,'recovered');assert.equal(calls,2);assert.equal(result.outputTokens,8);
  const event=(await readFile(join(runDir,'journal.jsonl'),'utf8')).trim().split('\n').map(JSON.parse).find(x=>x.type==='agent-finished');
  assert.equal(event.inputTokens,24);assert.equal(event.cachedInputTokens,5);
 }finally{controller.abort(Error('test cleanup'));await pending.catch(()=>{});await rm(runDir,{recursive:true,force:true});}
});
