import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';
const header='export const meta={name:"provider-policy",description:"provider-policy"};';
test('provider-specific host policies require a declared invocation provider before adapter startup',async()=>{
 for(const defaultProvider of [undefined,null])for(const policy of [{forcedModel:'host-required'},{model:'host-default',effort:'high'},{mcpServers:{source:{command:'fixture'}}}]){
  const runDir=await mkdtemp(join(tmpdir(),'provider-policy-'));let calls=0;
  try{
   await assert.rejects(runWorkflow({runDir,defaultProvider,hostContext:{id:'host',revision:'1',providers:{codex:policy}},script:header+'return agent("inspect",{model:"workflow-choice"});',agent:async()=>{calls++;return {result:'should not start',outputTokens:0};}}),{name:'TypeError',message:/opts\.provider or defaultProvider/});
   assert.equal(calls,0);
  }finally{await rm(runDir,{recursive:true,force:true});}
 }
});

test('generic workflows remain provider-free when no provider policy is configured',async()=>{
 for(const providers of [undefined,{}, {codex:{}}]){
  const runDir=await mkdtemp(join(tmpdir(),'provider-generic-'));
  try{const output=await runWorkflow({runDir,hostContext:{id:'host',revision:'1',...(providers?{providers}:{})},script:header+'return agent("inspect");',agent:async()=>({result:'generic result',outputTokens:0})});assert.equal(output.result,'generic result');}finally{await rm(runDir,{recursive:true,force:true});}
 }
});

test('declared default and per-call providers resolve the selected forced model',async()=>{
 for(const explicit of [false,true]){
  const runDir=await mkdtemp(join(tmpdir(),'provider-resolved-'));
  try{const output=await runWorkflow({runDir,defaultProvider:'codex',hostContext:{id:'host',revision:'1',providers:{codex:{forcedModel:'codex-required'},claude:{forcedModel:'claude-required'}}},script:header+`return agent("inspect",{model:"workflow-choice"${explicit?',provider:"claude"':''}});`,agent:async(_prompt,options)=>({result:options.model,outputTokens:0})});assert.equal(output.result,explicit?'claude-required':'codex-required');}finally{await rm(runDir,{recursive:true,force:true});}
 }
});
