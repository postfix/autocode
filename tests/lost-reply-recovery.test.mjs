import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';
test('a provider-reported lost reply retries and includes its spent tokens',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'lost-reply-'));let calls=0;
 try{
  const result=await runWorkflow({runDir,script:'export const meta={name:"lost",description:"lost"};return agent("request");',agent:async()=>++calls===1?{stalled:true,replyLost:true,outputTokens:3}:{result:'recovered',outputTokens:2}});
  assert.equal(result.result,'recovered');assert.equal(calls,2);assert.equal(result.outputTokens,5);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('typed terminal lost-stream errors retry without losing measured usage',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'lost-stream-error-'));let calls=0;
 try{
  const result=await runWorkflow({runDir,script:'export const meta={name:"lost",description:"lost"};return agent("request");',agent:async(_prompt,_opts,context)=>{if(++calls===1){context.onUsage({outputTokens:3});const error=Error('native stream disconnected');error.kind='lost-reply';throw error;}return {result:'recovered',outputTokens:2};}});
  assert.equal(result.result,'recovered');assert.equal(calls,2);assert.equal(result.outputTokens,5);
 }finally{await rm(runDir,{recursive:true,force:true});}
});
