import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';
test('a stalled agent is cancelled and bounded retries fail visibly',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'stall-parity-'));
 try {
  await assert.rejects(runWorkflow({runDir,script:'export const meta={name:"stall",description:"stall"};return agent("stalled",{stallMs:5});',
   agent:async(_p,_o,context)=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>resolve({result:'late',outputTokens:1}),50);
    context.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(context.signal.reason);},{once:true});
   })}),/stalled/);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('skipping an individual agent returns null without cancelling its workflow',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'skip-parity-'));
 let control;
 try {
  const output=await runWorkflow({runDir,subscribeControls:handler=>{control=handler;return ()=>{};},
   script:'export const meta={name:"skip",description:"skip"};const result=await agent("wait");return {result,continued:true};',
   agent:async(_p,_o,context)=>new Promise((resolve,reject)=>{
    context.signal?.addEventListener('abort',()=>reject(context.signal.reason),{once:true});
    setTimeout(()=>{if(control)control({agent:1,command:'skip'});else resolve({result:'not skipped',outputTokens:0});},0);
   })});
  assert.deepEqual(output.result,{result:null,continued:true});
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('retrying an individual agent replaces its cancelled attempt',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'retry-parity-'));
 let control,first=true;
 try {
  const output=await runWorkflow({runDir,subscribeControls:handler=>{control=handler;return ()=>{};},
   script:'export const meta={name:"retry",description:"retry"};return agent("wait");',
   agent:async(_p,_o,context)=>{
    if(!first)return {result:'replacement',outputTokens:1};first=false;
    return new Promise((resolve,reject)=>{context.signal.addEventListener('abort',()=>reject(context.signal.reason),{once:true});setTimeout(()=>control({agent:1,command:'retry'}),0);});
   }});
  assert.equal(output.result,'replacement');
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('a user-skipped agent is shown as skipped rather than failed',async()=>{
 const {runAutocode}=await import('../scripts/autocode.mjs');
 const runDir=await mkdtemp(join(tmpdir(),'skip-status-'));let control;
 try {
  await runWorkflow({runDir,subscribeControls:handler=>{control=handler;return ()=>{};},script:'export const meta={name:"skip",description:"skip"};return agent("wait");',
   agent:async(_p,_o,context)=>new Promise((resolve,reject)=>{context.signal.addEventListener('abort',()=>reject(context.signal.reason),{once:true});setTimeout(()=>control({agent:1,command:'skip'}),0);})});
  const status=await runAutocode(['status','--run-dir',runDir,'--json']);
  assert.equal(status.agents[0].state,'skipped');
  assert.equal(status.errorCount,0);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('stall retries cannot launch after reported usage exhausts the budget',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'retry-budget-'));
 try {
  await assert.rejects(runWorkflow({runDir,budget:7,script:'export const meta={name:"budget",description:"budget"};return agent("wait",{stallMs:5});',
   agent:async(_p,_o,context)=>{context.onUsage({outputTokens:7});return new Promise((resolve,reject)=>context.signal.addEventListener('abort',()=>reject(context.signal.reason),{once:true}));}}),/budget exceeded/);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('a terminal provider failure returns null and leaves the workflow running',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'terminal-api-'));
 try {
  const output=await runWorkflow({runDir,script:'export const meta={name:"terminal",description:"terminal"};const result=await agent("request");return {result,continued:true};',
   agent:async()=>{const error=Error('model unavailable');error.kind='terminal-api';throw error;}});
  assert.deepEqual(output.result,{result:null,continued:true});assert.match(output.failures[0],/model unavailable/);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('a host quota wait can release a rate-limited call for retry',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'quota-wait-'));let first=true;
 try {
  const output=await runWorkflow({runDir,hostContext:{id:'session',revision:'1',waitForQuota:async()=>true},script:'export const meta={name:"quota",description:"quota"};return agent("request");',
   agent:async()=>{if(first){first=false;const error=Error('quota exhausted');error.kind='rate-limit';throw error;}return {result:'after reset',outputTokens:1};}});
  assert.equal(output.result,'after reset');
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('finalized provider overload failures return null and preserve workflow progress',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'final-api-'));
 try{
  let calls=0;
  const result=await runWorkflow({runDir,script:'export const meta={name:"api",description:"api"};return [await agent("failed"),await agent("next")];',agent:async()=>{if(++calls===1){const error=Error('provider retries exhausted');error.kind='transient-api';throw error;}return {result:'continued',outputTokens:0};}});
  assert.deepEqual(result.result,[null,'continued']);assert.equal(result.failures.length,1);assert.equal(calls,2);
 }finally{await rm(runDir,{recursive:true,force:true});}
});
