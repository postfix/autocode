import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkflow } from '../scripts/runtime.mjs';

test('an omitted per-call provider never hides a changed default provider on replay', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom('codex', 'claude'), async provider => {
    const runDir = await mkdtemp(join(tmpdir(), 'provider-replay-'));
    const script = 'export const meta={name:"provider",description:"probe"}; return agent("check", {provider:undefined});';
    try {
      const first = await runWorkflow({script,runDir,defaultProvider:provider,
        agent:async()=>({result:'original',outputTokens:1})});
      const resumed = await runWorkflow({script,runDir,defaultProvider:provider==='codex'?'claude':'codex',
        resumeFromRunId:first.runId,agent:async()=>({result:'changed provider',outputTokens:1})});
      assert.equal(resumed.result,'changed provider');
    } finally { await rm(runDir,{recursive:true,force:true}); }
  }), {seed:42,numRuns:4});
});

test('replay cannot reuse an answer from a different working directory',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'cwd-replay-'));
 const script='export const meta={name:"cwd",description:"cwd"};return agent("inspect");';
 try {
  const first=await runWorkflow({script,runDir,cwd:'/project/one',agent:async()=>({result:'first directory',outputTokens:0})});
  const resumed=await runWorkflow({script,runDir,cwd:'/project/two',resumeFromRunId:first.runId,agent:async()=>({result:'second directory',outputTokens:0})});
  assert.equal(resumed.result,'second directory');
 }finally{await rm(runDir,{recursive:true,force:true});}
});
