import test from 'node:test';
import assert from 'node:assert/strict';
import {claudeAgent} from '../scripts/claude-adapter.mjs';
import {codexAgent} from '../scripts/codex-adapter.mjs';

test('Claude native compact boundary reports completed progress without inventing a start or model response',async()=>{
 const activity=[];let responses=0;
 await claudeAgent('Continue',{}, {runDir:'/tmp',cwd:'/tmp',onActivity:event=>activity.push(event),onResponse:()=>responses++,query:async function*(){
  yield {type:'system',subtype:'compact_boundary',uuid:'boundary-1',session_id:'private-session',compact_metadata:{trigger:'auto',pre_tokens:12000,post_tokens:1000,duration_ms:25,preserved_segment:{head_uuid:'private-head',anchor_uuid:'private-anchor',tail_uuid:'private-tail'}}};
  yield {type:'result',subtype:'success',result:'done',usage:{output_tokens:1}};
 }});
 assert.deepEqual(activity,[{id:'context-compaction-1',tool:'context_compaction',status:'completed'}]);
 assert.equal(responses,0,'system compaction is not a genuine model response for prefix warmup');
});

test('Codex compaction item start and completion share activity identity without claiming a model response',async()=>{
 const activity=[];let responses=0;
 class NativeCodex{startThread(){return {runStreamed:async()=>({events:(async function*(){
  yield {type:'item.started',item:{id:'compaction-1',type:'context_compaction'}};
  yield {type:'item.completed',item:{id:'compaction-1',type:'context_compaction'}};
  yield {type:'turn.completed',usage:{output_tokens:0,input_tokens:10,cached_input_tokens:0}};
 })()})};}}
 await codexAgent('Continue',{}, {runDir:'/tmp',cwd:'/tmp',Codex:NativeCodex,onActivity:event=>activity.push(event),onResponse:()=>responses++});
 assert.deepEqual(activity,[{id:'compaction-1',tool:'context_compaction',status:'running'},{id:'compaction-1',tool:'context_compaction',status:'completed'}]);
 assert.equal(responses,0,'compaction progress must not release genuine-response prefix warmup');
});

test('Claude native compaction hooks suspend the watchdog and share completion identity with the boundary',async()=>{
 const {runWorkflow}=await import('../scripts/runtime.mjs');
 const {mkdtemp,rm}=await import('node:fs/promises');
 const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const {setTimeout:delay}=await import('node:timers/promises');
 const runDir=await mkdtemp(join(tmpdir(),'native-compaction-')),activity=[];
 try{
  const output=await runWorkflow({runDir,script:'export const meta={name:"compact",description:"Keep native compaction alive"};return agent("Continue",{stallMs:20});',hostContext:{id:'host',revision:'1',canUseTool:async()=>({behavior:'deny',message:'not used'})},agent:(prompt,opts,context)=>claudeAgent(prompt,opts,{...context,onActivity:event=>{activity.push(event);context.onActivity(event);},query:async function*({options}){
   assert.equal(typeof options.hooks?.PreCompact?.[0].hooks[0],'function');
   assert.equal(typeof options.hooks?.PostCompact?.[0].hooks[0],'function');
   assert.equal((await options.hooks.PreToolUse[0].hooks[0]()).hookSpecificOutput.permissionDecision,'ask','compaction hooks must preserve the trusted permission gate');
   await options.hooks.PreCompact[0].hooks[0]({hook_event_name:'PreCompact',session_id:'private-session',trigger:'auto',custom_instructions:'PRIVATE_INSTRUCTIONS'});
   await delay(60);assert.equal(context.signal.aborted,false,'native compaction activity must suspend the no-progress watchdog');
   await options.hooks.PostCompact[0].hooks[0]({hook_event_name:'PostCompact',session_id:'private-session',trigger:'auto',compact_summary:'PRIVATE_SUMMARY'});
   yield {type:'system',subtype:'compact_boundary',uuid:'boundary-1',session_id:'private-session',compact_metadata:{trigger:'auto',pre_tokens:1000}};
   yield {type:'result',subtype:'success',result:'continued',usage:{output_tokens:1}};
  }})});
  assert.equal(output.result,'continued');
  assert.deepEqual(activity,[{id:'context-compaction-1',tool:'context_compaction',status:'running'},{id:'context-compaction-1',tool:'context_compaction',status:'completed'},{id:'context-compaction-1',tool:'context_compaction',status:'completed'}]);
  assert.doesNotMatch(JSON.stringify(activity),/PRIVATE_|private-session/);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('Claude failed compaction status ends the same activity and restores the silent-query watchdog',async()=>{
 const {runWorkflow}=await import('../scripts/runtime.mjs');
 const {mkdtemp,rm}=await import('node:fs/promises');
 const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const runDir=await mkdtemp(join(tmpdir(),'failed-compaction-')),activity=[];
 const controller=new AbortController();let calls=0,responses=0;
 const deadline=setTimeout(()=>controller.abort(Error('Test safety deadline')),10000);
 try{
  await assert.rejects(runWorkflow({runDir,signal:controller.signal,script:'export const meta={name:"failed-compact",description:"Restore watchdog"};return agent("Continue",{stallMs:20});',agent:(prompt,opts,context)=>claudeAgent(prompt,opts,{...context,onResponse:()=>{responses++;context.onResponse?.();},onActivity:event=>{activity.push(event);context.onActivity(event);},query:async function*({options}){
   calls++;
   await options.hooks.PreCompact[0].hooks[0]({hook_event_name:'PreCompact',session_id:'private-session',trigger:'auto'});
   yield {type:'system',subtype:'status',status:null,session_id:'private-session',compact_result:'failed',compact_error:'PRIVATE_COMPACTION_ERROR'};
   assert.deepEqual(activity.slice(-2),[{id:'context-compaction-1',tool:'context_compaction',status:'running'},{id:'context-compaction-1',tool:'context_compaction',status:'failed'}]);
   await new Promise((resolve,reject)=>{
    if(context.signal.aborted)reject(context.signal.reason);
    else context.signal.addEventListener('abort',()=>reject(context.signal.reason),{once:true});
   });
  }})}),/stalled/);
  assert.equal(calls,6,'five bounded retries must be reachable after compaction ends');
  assert.equal(responses,0,'failure status must not release genuine-response prefix warm-up');
  assert.doesNotMatch(JSON.stringify(activity),/PRIVATE_|private-session/);
 }finally{clearTimeout(deadline);controller.abort(Error('Test cleanup'));await rm(runDir,{recursive:true,force:true});}
});

test('Claude status ends only tracked active compactions and ignores later unrelated statuses',async()=>{
 const activity=[];let responses=0;
 await claudeAgent('Continue',{}, {runDir:'/tmp',cwd:'/tmp',onActivity:event=>activity.push(event),onResponse:()=>responses++,query:async function*({options}){
  const session_id='private-session';
  yield {type:'system',subtype:'status',status:null,session_id,compact_result:'failed',compact_error:'PRIVATE_ERROR'};
  yield {type:'system',subtype:'status',status:'requesting',session_id};
  await options.hooks.PreCompact[0].hooks[0]({session_id});
  yield {type:'system',subtype:'status',status:null,session_id,compact_result:'success'};
  yield {type:'system',subtype:'status',status:null,session_id,compact_result:'failed'};
  await options.hooks.PreCompact[0].hooks[0]({session_id});
  await options.hooks.PostCompact[0].hooks[0]({session_id,compact_summary:'PRIVATE_SUMMARY'});
  yield {type:'system',subtype:'status',status:null,session_id,compact_result:'failed'};
  await options.hooks.PreCompact[0].hooks[0]({session_id});
  yield {type:'system',subtype:'compact_boundary',session_id,compact_metadata:{trigger:'auto',pre_tokens:1000}};
  yield {type:'system',subtype:'status',status:null,session_id,compact_result:'failed'};
  yield {type:'result',subtype:'success',result:'done',usage:{output_tokens:1}};
 }});
 assert.deepEqual(activity,Array.from({length:3},()=>[{id:'context-compaction-1',tool:'context_compaction',status:'running'},{id:'context-compaction-1',tool:'context_compaction',status:'completed'}]).flat());
 assert.equal(responses,0);
 assert.doesNotMatch(JSON.stringify(activity),/PRIVATE_|private-session/);
});
