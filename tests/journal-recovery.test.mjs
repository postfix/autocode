import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';
test('an interrupted final journal write does not discard completed answers',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'journal-recovery-'));
 const script='export const meta={name:"recover",description:"recover"};return agent("done");';
 try {
  const first=await runWorkflow({runDir,script,agent:async()=>({result:'retained',outputTokens:1})});
  await appendFile(join(runDir,'journal.jsonl'),'{"type":"sta');
  const resumed=await runWorkflow({runDir,script,resumeFromRunId:first.runId,agent:async()=>{throw Error('must retain completed call');}});
  assert.equal(resumed.result,'retained');
  const again=await runWorkflow({runDir,script,resumeFromRunId:first.runId,agent:async()=>{throw Error('must retain completed call');}});
  assert.equal(again.result,'retained');
 }finally{await rm(runDir,{recursive:true,force:true});}
});
