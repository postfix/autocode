import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkflow } from '../scripts/runtime.mjs';

test('a child phase cannot replace the parent phase', async () => {
  const runDir=await mkdtemp(join(tmpdir(),'child-phase-'));
  try {
    const output=await runWorkflow({runDir,
      script:'export const meta={name:"parent",description:"parent"}; phase("Review"); await workflow("child"); log("parent resumed"); return 1;',
      resolveWorkflow:async()=> 'export const meta={name:"child",description:"child"}; phase("Child phase"); return 2;',
      agent:async()=>{throw Error('unexpected agent');}});
    assert.deepEqual(output.logs,[{phase:'Review',message:'parent resumed'}]);
  } finally {await rm(runDir,{recursive:true,force:true});}
});

test('child agents use their own progress group and leave parent agents in the parent phase',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'child-group-')),phases=[];
 try {
  await runWorkflow({runDir,script:'export const meta={name:"parent",description:"parent"};phase("Review");await workflow("child");return agent("parent");',
   resolveWorkflow:async()=> 'export const meta={name:"child",description:"child"};return agent("child");',
   onProgress:event=>{if(event.type==='agent-started')phases.push(event.phase);},agent:async()=>({result:'done',outputTokens:0})});
  assert.deepEqual(phases,['workflow child','Review']);
 }finally{await rm(runDir,{recursive:true,force:true});}
});
