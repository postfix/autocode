import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setImmediate as immediate} from 'node:timers/promises';
import {runWorkflow} from '../scripts/runtime.mjs';
const waitFor=async predicate=>{const deadline=performance.now()+10000;while(!predicate()){if(performance.now()>deadline)throw Error('Timed out waiting for watchdog adapter progress');await immediate();}};
test('the default no-progress watchdog waits ten minutes before retrying',async t=>{
 const runDir=await mkdtemp(join(tmpdir(),'watchdog-default-'));let calls=0;const controller=new AbortController();let pending;
 const saved=Object.fromEntries(['CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS','CLAUDE_STREAM_IDLE_TIMEOUT_MS'].map(key=>[key,process.env[key]]));
 for(const key of Object.keys(saved))delete process.env[key];
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  pending=runWorkflow({runDir,signal:controller.signal,script:'export const meta={name:"watchdog",description:"watchdog"};return agent("request");',agent:async(_p,_o,context)=>{calls++;if(calls>1)return {result:'recovered',outputTokens:0};return new Promise((resolve,reject)=>context.signal.addEventListener('abort',()=>reject(context.signal.reason),{once:true}));}});pending.catch(()=>{});
  await waitFor(()=>calls>=1);
  t.mock.timers.tick(300000);for(let i=0;i<100;i++)await immediate();assert.equal(calls,1);
  t.mock.timers.tick(300000);await waitFor(()=>calls>=2);assert.equal(calls,2);assert.equal((await pending).result,'recovered');
 }finally{controller.abort(Error('test cleanup'));await pending?.catch(()=>{});t.mock.timers.reset();for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await rm(runDir,{recursive:true,force:true});}
});

test('explicit async stall timeout environment overrides the computed default',async t=>{
 const runDir=await mkdtemp(join(tmpdir(),'watchdog-env-'));let calls=0;const saved=process.env.CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS;const controller=new AbortController();
 process.env.CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS='17';t.mock.timers.enable({apis:['setTimeout']});
 let pending;
 try{
  pending=runWorkflow({runDir,signal:controller.signal,script:'export const meta={name:"watchdog",description:"watchdog"};return agent("request");',agent:async(_p,_o,context)=>{calls++;if(calls>1)return {result:'recovered',outputTokens:0};return new Promise((resolve,reject)=>context.signal.addEventListener('abort',()=>reject(context.signal.reason),{once:true}));}});pending.catch(()=>{});
  await waitFor(()=>calls>=1);t.mock.timers.tick(17);await waitFor(()=>calls>=2);
  assert.equal(calls,2);assert.equal((await pending).result,'recovered');
 }finally{controller.abort(Error('test cleanup'));await pending?.catch(()=>{});t.mock.timers.reset();if(saved===undefined)delete process.env.CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS;else process.env.CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS=saved;await rm(runDir,{recursive:true,force:true});}
});

test('stream idle timeout extends the watchdog by five minutes',async t=>{
 const runDir=await mkdtemp(join(tmpdir(),'watchdog-default-'));let calls=0;const controller=new AbortController();let pending;
 const saved=Object.fromEntries(['CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS','CLAUDE_STREAM_IDLE_TIMEOUT_MS'].map(key=>[key,process.env[key]]));
 for(const key of Object.keys(saved))delete process.env[key];
 process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS='900000';
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  pending=runWorkflow({runDir,signal:controller.signal,script:'export const meta={name:"watchdog",description:"watchdog"};return agent("request");',agent:async(_p,_o,context)=>{calls++;if(calls>1)return {result:'recovered',outputTokens:0};return new Promise((resolve,reject)=>context.signal.addEventListener('abort',()=>reject(context.signal.reason),{once:true}));}});pending.catch(()=>{});
  await waitFor(()=>calls>=1);
  t.mock.timers.tick(600000);for(let i=0;i<100;i++)await immediate();assert.equal(calls,1);
  t.mock.timers.tick(600000);await waitFor(()=>calls>=2);assert.equal((await pending).result,'recovered');assert.equal(calls,2);
 }finally{controller.abort(Error('test cleanup'));await pending?.catch(()=>{});t.mock.timers.reset();for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await rm(runDir,{recursive:true,force:true});}
});

test('disabled stream watchdog keeps the fixed ten-minute agent timeout',async t=>{
 const runDir=await mkdtemp(join(tmpdir(),'watchdog-default-'));let calls=0;const controller=new AbortController();let pending;
 const saved=Object.fromEntries(['CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS','CLAUDE_STREAM_IDLE_TIMEOUT_MS','CLAUDE_ENABLE_STREAM_WATCHDOG'].map(key=>[key,process.env[key]]));
 for(const key of Object.keys(saved))delete process.env[key];
 process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS='900000';process.env.CLAUDE_ENABLE_STREAM_WATCHDOG='false';
 t.mock.timers.enable({apis:['setTimeout']});
 try{
  pending=runWorkflow({runDir,signal:controller.signal,script:'export const meta={name:"watchdog",description:"watchdog"};return agent("request");',agent:async(_p,_o,context)=>{calls++;if(calls>1)return {result:'recovered',outputTokens:0};return new Promise((resolve,reject)=>context.signal.addEventListener('abort',()=>reject(context.signal.reason),{once:true}));}});pending.catch(()=>{});
  await waitFor(()=>calls>=1);
  t.mock.timers.tick(300000);for(let i=0;i<100;i++)await immediate();assert.equal(calls,1);
  t.mock.timers.tick(300000);await waitFor(()=>calls>=2);assert.equal(calls,2);assert.equal((await pending).result,'recovered');
 }finally{controller.abort(Error('test cleanup'));await pending?.catch(()=>{});t.mock.timers.reset();for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await rm(runDir,{recursive:true,force:true});}
});
