import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runWorkflow} from '../scripts/runtime.mjs';
test('interleaved groups preserve replay identity when completion timing changes',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'replay-interleaving-'));let calls=0;
 const script='export const meta={name:"interleaved",description:"interleaved"};const a=parallel([()=>agent("slow")]);const b=pipeline([0],()=>agent("fast"));const groups=await Promise.all([a,b]);return [groups,await agent("summary")];';
 try{
  const first=await runWorkflow({script,runDir,agent:async prompt=>{calls++;if(prompt==='slow')await new Promise(r=>setTimeout(r,20));return {result:prompt,outputTokens:1};}});
  const resumed=await runWorkflow({script,runDir,resumeFromRunId:first.runId,agent:async()=>{calls++;return {result:'unexpected',outputTokens:1};}});
  assert.deepEqual(resumed.result,first.result);assert.equal(calls,3);
 }finally{await rm(runDir,{recursive:true,force:true});}
});
