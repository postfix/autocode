import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runWorkflow} from '../scripts/runtime.mjs';
const meta='export const meta={name:"boundaries",description:"boundaries"};';
test('nested repeated groups preserve generated results and reuse version 2 journals',async()=>{
 await fc.assert(fc.asyncProperty(fc.array(fc.integer({min:0,max:9}),{minLength:1,maxLength:5}),async values=>{
  const runDir=await mkdtemp(join(tmpdir(),'replay-nested-'));let calls=0;
  const script=meta+'const groups=[];for(const value of args){groups.push(await parallel([()=>agent("same"),()=>pipeline([value],()=>agent("same"))]));groups.push(await agent("direct"));}return groups;';
  try{
   const first=await runWorkflow({script,args:values,runDir,agent:async()=>{const result=++calls;await new Promise(resolve=>setTimeout(resolve,values[result%values.length]%3));return {result,outputTokens:1};}});
   const resumed=await runWorkflow({script,args:values,runDir,resumeFromRunId:first.runId,agent:async()=>{throw Error('completed work repeated');}});
   assert.deepEqual(resumed.result,first.result);assert.equal(calls,values.length*3);assert.equal(resumed.outputTokens,0);
  }finally{await rm(runDir,{recursive:true,force:true});}
 }),{seed:20261102,numRuns:30});
});
test('legacy ambiguous journals are rejected without changing either file',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'replay-legacy-'));const run='{"runId":"legacy","journalVersion":1}';const journal='{"type":"result","key":"collision","result":2}\n{"partial":';
 try{
  await writeFile(join(runDir,'run.json'),run);await writeFile(join(runDir,'journal.jsonl'),journal);
  await assert.rejects(runWorkflow({script:meta+'return agent("same")',runDir,resumeFromRunId:'legacy',agent:async()=>{throw Error('must not run');}}),/Legacy replay journal is incompatible/);
  assert.equal(await readFile(join(runDir,'run.json'),'utf8'),run);assert.equal(await readFile(join(runDir,'journal.jsonl'),'utf8'),journal);
 }finally{await rm(runDir,{recursive:true,force:true});}
});
test('changed agent options invalidate only subsequent work',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'replay-options-'));let calls=0;
 const source=model=>meta+`await agent("prefix");return agent("answer",{model:${JSON.stringify(model)}});`;
 try{
  const first=await runWorkflow({script:source('old'),runDir,agent:async()=>({result:++calls,outputTokens:1})});
  const resumed=await runWorkflow({script:source('new'),runDir,resumeFromRunId:first.runId,agent:async(_prompt,opts)=>({result:opts.model,outputTokens:1})});
  assert.equal(resumed.result,'new');assert.equal(resumed.outputTokens,1);assert.equal(calls,2);
 }finally{await rm(runDir,{recursive:true,force:true});}
});
