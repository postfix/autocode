import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';
test('reported tokens from a failed call still consume the workflow budget',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'usage-parity-'));
 try {
  const output=await runWorkflow({runDir,budget:7,
   script:'export const meta={name:"usage",description:"usage"};try{await agent("fails")}catch{}return budget.spent();',
   agent:async(_p,_o,context)=>{context.onUsage({outputTokens:7});throw Error('provider failed after output');}});
  assert.equal(output.result,7);
 }finally{await rm(runDir,{recursive:true,force:true});}
});
test('resume retains spent output tokens without charging cached answers twice',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'usage-resume-'));
 const script='export const meta={name:"usage",description:"usage"};await agent("one");return budget.spent();';
 try {
  const first=await runWorkflow({script,runDir,agent:async()=>({result:'done',outputTokens:7})});
  const resumed=await runWorkflow({script,runDir,resumeFromRunId:first.runId,agent:async()=>{throw Error('cached call should not execute');}});
  assert.equal(resumed.result,7);
 }finally{await rm(runDir,{recursive:true,force:true});}
});
test('CLI status includes reported usage from failed calls',async()=>{
 const {runAutocode}=await import('../scripts/autocode.mjs');
 const runDir=await mkdtemp(join(tmpdir(),'failed-usage-status-'));
 try {
  await runWorkflow({runDir,script:'export const meta={name:"usage",description:"usage"};try{await agent("fails")}catch{}return 1;',agent:async(_p,_o,context)=>{context.onUsage({outputTokens:7});throw Error('provider failed');}});
  const status=await runAutocode(['status','--run-dir',runDir,'--json']);
  assert.equal(status.outputTokens,7);
 }finally{await rm(runDir,{recursive:true,force:true});}
});
test('unknown provider usage remains explicit in workflow results',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'unknown-usage-'));
 try {
  const output=await runWorkflow({runDir,script:'export const meta={name:"usage",description:"usage"};return agent("request");',agent:async()=>({result:'done',outputTokens:0,usageIncomplete:true})});
  assert.equal(output.usageIncomplete,true);
 }finally{await rm(runDir,{recursive:true,force:true});}
});
