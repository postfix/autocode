import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';
test('agents inherit resolved model and effort from trusted host context',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'host-context-'));
 try {
  const output=await runWorkflow({runDir,defaultProvider:'codex',hostContext:{id:'session',revision:'1',providers:{codex:{model:'host-model',effort:'high'}}},
   script:'export const meta={name:"host",description:"host"};return agent("inspect");',
   agent:async(_prompt,opts)=>({result:{model:opts.model??null,effort:opts.effort??null},outputTokens:0})});
  assert.deepEqual(output.result,{model:'host-model',effort:'high'});
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('workflows sharing a host budget cannot independently spend its remaining tokens',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shared-budget-'));
 let spent=0;
 const budget={total:5,spent:()=>spent,charge:count=>{spent+=count;}};
 const hostContext={id:'session',revision:'1',budget};
 const script='export const meta={name:"shared",description:"shared"};return agent("one");';
 try {
  await runWorkflow({runDir:join(root,'first'),hostContext,script,agent:async()=>({result:'first',outputTokens:5})});
  await assert.rejects(runWorkflow({runDir:join(root,'second'),hostContext,script,agent:async()=>({result:'over budget',outputTokens:1})}),/budget exceeded/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('a trusted spawn hook can deny a computed agent task',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'spawn-deny-'));
 try {
  await assert.rejects(runWorkflow({runDir,hostContext:{id:'session',revision:'1',onSpawn:async()=>({deny:'blocked by host'})},
   script:'export const meta={name:"deny",description:"deny"};return agent("inspect");',agent:async()=>({result:'should not execute',outputTokens:0})}),/blocked by host/);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('a host-forced model takes precedence over workflow model choices',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'forced-model-'));
 try {
  const output=await runWorkflow({runDir,defaultProvider:'codex',hostContext:{id:'session',revision:'1',providers:{codex:{forcedModel:'required-model'}}},
   script:'export const meta={name:"forced",description:"forced"};return agent("inspect",{model:"other-model"});',agent:async(_p,opts)=>({result:opts.model,outputTokens:0})});
  assert.equal(output.result,'required-model');
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('custom agent defaults take precedence over inherited provider defaults',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'custom-defaults-'));
 try {
  const output=await runWorkflow({runDir,defaultProvider:'codex',hostContext:{id:'session',revision:'1',providers:{codex:{model:'host-model'}},agents:{reviewer:{prompt:'policy',model:'custom-model'}}},
   script:'export const meta={name:"custom",description:"custom"};return agent("inspect",{agentType:"reviewer"});',agent:async(_p,opts)=>({result:opts.model,outputTokens:0})});
  assert.equal(output.result,'custom-model');
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('host-denied calls still count toward the workflow agent-call cap',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'denial-cap-'));
 try {
  const output=await runWorkflow({runDir,hostContext:{id:'session',revision:'1',onSpawn:async()=>({deny:'host denied'})},
   script:'export const meta={name:"cap",description:"cap"};for(let i=0;i<1001;i++){try{await agent("denied")}catch(error){if(error.message.includes("call cap"))return "capped";}}return "uncapped";',agent:async()=>({result:'unexpected',outputTokens:0})});
  assert.equal(output.result,'capped');
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('named-only host policy refuses child script paths',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'named-only-'));
 try {
  await assert.rejects(runWorkflow({runDir,hostContext:{id:'session',revision:'1',namedWorkflowsOnly:true},script:'export const meta={name:"parent",description:"parent"};return workflow({scriptPath:"child.js"});',resolveWorkflow:async()=> 'export const meta={name:"child",description:"child"};return 1;',agent:async()=>{}}),/named workflows only/);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('a host can supply an authoritative named workflow registry',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'host-registry-'));
 try {
  const output=await runWorkflow({runDir,hostContext:{id:'session',revision:'1',namedWorkflowsOnly:true,workflows:{child:'export const meta={name:"child",description:"child"};return args.value;'}},
   script:'export const meta={name:"parent",description:"parent"};return workflow("child",{value:42});',agent:async()=>{}});
  assert.equal(output.result,42);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('a trusted host receives the completed workflow result',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'host-complete-'));let notification;
 try {
  await runWorkflow({runDir,hostContext:{id:'session',revision:'1',onComplete:async result=>{notification=result.result;}},script:'export const meta={name:"complete",description:"complete"};return 42;',agent:async()=>{}});
  assert.equal(notification,42);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('a failed completion notification does not discard a completed result',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'notification-failure-'));
 try {
  const output=await runWorkflow({runDir,hostContext:{id:'session',revision:'1',onComplete:async()=>{throw Error('notification unavailable');}},script:'export const meta={name:"complete",description:"complete"};return 42;',agent:async()=>{}});
  assert.equal(output.result,42);assert.match(output.failures[0],/notification unavailable/);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('a trusted host receives the original workflow failure',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'host-failure-'));let notification;
 try {
  await assert.rejects(runWorkflow({runDir,hostContext:{id:'session',revision:'1',onFailure:async value=>{notification=value.error;}},script:'export const meta={name:"fail",description:"fail"};throw Error("workflow broke");',agent:async()=>{}}),/workflow broke/);
  assert.equal(notification,'workflow broke');
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('completion notification failures remain visible in CLI status',async()=>{
 const {runAutocode}=await import('../scripts/autocode.mjs');
 const runDir=await mkdtemp(join(tmpdir(),'notification-status-'));
 try {
  await runWorkflow({runDir,hostContext:{id:'session',revision:'1',onComplete:async()=>{throw Error('delivery failed');}},script:'export const meta={name:"complete",description:"complete"};return 42;',agent:async()=>{}});
  const status=await runAutocode(['status','--run-dir',runDir,'--json']);
  assert.equal(status.errorCount,1);assert.match(status.notificationErrors[0],/delivery failed/);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('trusted spawn rewrites affect execution and replay identity while forced model wins',async()=>{
 const root=await mkdtemp(join(tmpdir(),'spawn-rewrite-'));
 try {
  let text='rewritten one',calls=0;
  const base={runDir:root,defaultProvider:'codex',hostContext:{id:'session',revision:'1',providers:{codex:{forcedModel:'required-model'}},onSpawn:async()=>({prompt:text,model:'hook-model'})},script:'export const meta={name:"rewrite",description:"rewrite"};return agent("original");',agent:async(prompt,opts)=>{calls++;return {result:{prompt,model:opts.model},outputTokens:0};}};
  const first=await runWorkflow(base);
  assert.deepEqual(first.result,{prompt:'rewritten one',model:'required-model'});
  text='rewritten two';
  const second=await runWorkflow({...base,resumeFromRunId:first.runId});
  assert.deepEqual(second.result,{prompt:'rewritten two',model:'required-model'});
  assert.equal(calls,2);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('trusted spawn hooks receive immutable invocation identity and cancellation signal',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'spawn-identity-'));
 const controller=new AbortController();let seen;
 try {
  const result=await runWorkflow({runDir,signal:controller.signal,hostContext:{id:'session',revision:'1',onSpawn:async input=>{seen=input;return {prompt:'rewritten'};}},script:'export const meta={name:"identity",description:"identity"};return agent("original");',agent:async()=>({result:'ok',outputTokens:0})});
  assert.deepEqual(seen.workflow,{runId:result.runId,agentIndex:1});
  assert.equal(Object.isFrozen(seen.workflow),true);
  assert.equal(seen.signal,controller.signal);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('trusted host can withhold workflow prompt from spawn hooks and prevent prompt rewrites',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'spawn-privacy-'));let hookPrompt;
 try {
  const result=await runWorkflow({runDir,hostContext:{id:'session',revision:'1',shareWorkflowPrompt:false,onSpawn:async({prompt})=>{hookPrompt=prompt;return {prompt:'rewritten'};}},script:'export const meta={name:"privacy",description:"privacy"};return agent("PRIVATE_TASK");',agent:async prompt=>({result:prompt,outputTokens:0})});
  assert.equal(hookPrompt,'(withheld: this workflow run does not share its script)');
  assert.equal(result.result,'PRIVATE_TASK');
 }finally{await rm(runDir,{recursive:true,force:true});}
});
