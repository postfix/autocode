import test from 'node:test';
import fc from 'fast-check';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';
for(const helper of ['parallel','pipeline']) test(`${helper} recovery reuses completed siblings and refreshes downstream work`,async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'replay-interruption-'));
 const expression=helper==='parallel'?'parallel([()=>agent("unfinished"),()=>agent("completed")])':'pipeline(["unfinished","completed"],value=>agent(value))';
 const script=`export const meta={name:"resume",description:"resume"};const group=await ${expression};return [group,await agent("summary")];`;
 const calls=[];
 try{
  const first=await runWorkflow({script,runDir,agent:async prompt=>{if(prompt==='unfinished')throw Error('interrupted');return {result:prompt,outputTokens:1};}});
  const resumed=await runWorkflow({script,runDir,resumeFromRunId:first.runId,agent:async prompt=>{calls.push(prompt);return {result:prompt,outputTokens:1};}});
  assert.deepEqual(resumed.result,[["unfinished","completed"],"summary"]);
  assert.deepEqual(calls,['unfinished','summary']);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('interrupted nested groups reuse completed siblings at every generated position',async()=>{
 await fc.assert(fc.asyncProperty(fc.integer({min:2,max:7}),fc.nat({max:6}),async(size,position)=>{
  const failed=position%size;const runDir=await mkdtemp(join(tmpdir(),'replay-recovery-property-'));const calls=[];
  const script='export const meta={name:"recover",description:"recover"};const result=await parallel(args.map(value=>()=>pipeline([value],item=>agent(String(item)))));return [result,await agent("summary")];';
  const args=Array.from({length:size},(_,index)=>index);
  try{
   const first=await runWorkflow({script,args,runDir,agent:async prompt=>{await new Promise(resolve=>setTimeout(resolve,(size-Number(prompt))%3||0));if(prompt===String(failed))throw Error('interrupted');return {result:prompt,outputTokens:1};}});
   const resumed=await runWorkflow({script,args,runDir,resumeFromRunId:first.runId,agent:async prompt=>{calls.push(prompt);return {result:prompt,outputTokens:1};}});
   assert.deepEqual(resumed.result,[args.map(value=>[String(value)]),'summary']);assert.deepEqual(calls,[String(failed),'summary']);
  }finally{await rm(runDir,{recursive:true,force:true});}
 }),{seed:20261103,numRuns:30});
});
