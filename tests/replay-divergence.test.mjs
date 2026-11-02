import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';
test('recovered upstream work invalidates downstream cached answers',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'replay-divergence-'));
 const script='export const meta={name:"replay",description:"replay"};try{await agent("upstream")}catch{}return agent("summary");';
 try {
  const first=await runWorkflow({runDir,script,agent:async prompt=>{if(prompt==='upstream')throw Error('interrupted');return {result:'incomplete summary',outputTokens:1};}});
  const resumed=await runWorkflow({runDir,script,resumeFromRunId:first.runId,agent:async prompt=>({result:prompt==='upstream'?'recovered':'complete summary',outputTokens:1})});
  assert.equal(resumed.result,'complete summary');
 }finally{await rm(runDir,{recursive:true,force:true});}
});
