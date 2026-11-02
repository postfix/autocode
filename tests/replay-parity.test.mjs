import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkflow } from '../scripts/runtime.mjs';
for (const expression of ['parallel([()=>agent("same")])', 'pipeline([1],()=>agent("same"))']) {
 test(expression, async()=>{
  const runDir=await mkdtemp(join(tmpdir(),'parity-')); let calls=0;
  const agent=async()=>({result:++calls,outputTokens:1});
  const script=`export const meta={name:"probe",description:"probe"}; return [await ${expression},await ${expression}];`;
  try {
   const first=await runWorkflow({script,runDir,agent});
   const second=await runWorkflow({script,runDir,agent,resumeFromRunId:first.runId});
   assert.deepEqual(first.result,[[1],[2]]); assert.deepEqual(second.result,first.result); assert.equal(calls,2);
  } finally {await rm(runDir,{recursive:true,force:true});}
 });
}

test('queued agent options are captured when the call is made',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'options-snapshot-'));
 try {
  const output=await runWorkflow({runDir,concurrency:1,script:'export const meta={name:"snapshot",description:"snapshot"};const opts={schema:{type:"object",properties:{value:{type:"string"}},required:["value"]}};const first=agent("block");const second=agent("inspect",opts);opts.schema.properties.value.type="integer";await first;return await second;',
   agent:async(prompt,opts)=>{if(prompt==='block'){await new Promise(resolve=>setTimeout(resolve,5));return {result:'done',outputTokens:0};}return {result:opts.schema.properties.value.type,outputTokens:0};}});
  assert.equal(output.result,'string');
 }finally{await rm(runDir,{recursive:true,force:true});}
});
