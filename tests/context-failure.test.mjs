import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';
test('context overflow remains typed in the journal without retrying or changing public failures',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'context-failure-'));let calls=0;
 try{
  const output=await runWorkflow({runDir,script:'export const meta={name:"overflow",description:"overflow"};return agent("large task");',agent:async()=>{calls++;throw Object.assign(Error('opaque provider failure'),{kind:'terminal-api',codexErrorInfo:'contextWindowExceeded'});}});
  assert.equal(output.result,null);assert.deepEqual(output.failures,['opaque provider failure']);assert.equal(calls,1);
  const failed=(await readFile(join(runDir,'journal.jsonl'),'utf8')).trim().split('\n').map(JSON.parse).find(event=>event.type==='failed');
  assert.equal(failed.kind,'terminal-api');assert.equal(failed.codexErrorInfo,'contextWindowExceeded');
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('failure metadata retains known discriminators without serializing unknown fields or native payloads',async()=>{
 const cases=[
  {kind:'terminal-api',code:{httpConnectionFailed:{httpStatusCode:401,authorization:'sensitive-payload'}},expected:'httpConnectionFailed'},
  {kind:'terminal-api',code:'sensitive-payload',expected:undefined},
  {kind:'sensitive-payload',code:{authorization:'sensitive-payload'},expected:undefined},
 ];
 for(const item of cases){
  const runDir=await mkdtemp(join(tmpdir(),'context-metadata-'));
  try{
   const pending=runWorkflow({runDir,script:'export const meta={name:"metadata",description:"metadata"};return agent("inspect");',agent:async()=>{throw Object.assign(Error('opaque failure'),{kind:item.kind,codexErrorInfo:item.code});}});
   if(item.kind==='terminal-api')await pending;else await assert.rejects(pending,/opaque failure/);
   const journal=await readFile(join(runDir,'journal.jsonl'),'utf8');assert.ok(!journal.includes('sensitive-payload'));
   const failed=journal.trim().split('\n').map(JSON.parse).find(event=>event.type==='failed');
   assert.equal(failed.codexErrorInfo,item.expected);assert.equal(failed.kind,item.kind==='terminal-api'?'terminal-api':undefined);
  }finally{await rm(runDir,{recursive:true,force:true});}
 }
});
