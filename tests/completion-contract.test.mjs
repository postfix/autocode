import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {mkdir,mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runWorkflow} from '../scripts/runtime.mjs';
import {readRunStatus} from '../scripts/run-stats.mjs';
const scratch=fileURLToPath(new URL('../.scratch/',import.meta.url));
async function fixture(){await mkdir(scratch,{recursive:true});const root=await mkdtemp(join(scratch,'completion-contract-'));return {root,cwd:root,runDir:join(root,'run')};}

test('the success journal is terminal before the host completion callback runs',async()=>{
 const f=await fixture();let observed;
 try{
  const output=await runWorkflow({...f,hostContext:{id:'origin',revision:'1',onComplete:async()=>{observed=await readRunStatus(f.runDir);},onFailure:async()=>{}},script:'export const meta={name:"complete",description:"Terminal delivery ordering"};return 42;',agent:async()=>({result:'unused',outputTokens:0})});
  assert.equal(output.result,42);assert.equal(observed.state,'completed','a completion recipient must see a durably terminal workflow');
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('partial or malformed notification pairs are rejected before files or agents are started',async()=>{
 const cases={onlyComplete:{onComplete:async()=>{}},onlyFailure:{onFailure:async()=>{}},badComplete:{onComplete:'not a function',onFailure:async()=>{}},badFailure:{onComplete:async()=>{},onFailure:{}}};
 await fc.assert(fc.asyncProperty(fc.constantFrom(...Object.keys(cases)),async name=>{
  const f=await fixture();let agentCalls=0;
  try{
   await assert.rejects(runWorkflow({...f,hostContext:{id:'origin',revision:'1',...cases[name]},script:'export const meta={name:"invalid-pair",description:"Validate delivery first"};return agent("work");',agent:async()=>{agentCalls++;return {result:'done',outputTokens:0};}}),/both onComplete and onFailure/);
   assert.equal(agentCalls,0);await assert.rejects(access(f.runDir),{code:'ENOENT'});
  }finally{await rm(f.root,{recursive:true,force:true});}
 }),{seed:20261103,numRuns:12});
});

test('failed host delivery preserves the completed task and never invokes workflow failure delivery',async()=>{
 const f=await fixture();let calls=0,completed=0,failed=0,observed;
 try{
  const output=await runWorkflow({...f,hostContext:{id:'origin',revision:'1',onComplete:async()=>{completed++;observed=(await readRunStatus(f.runDir)).state;throw Error('completion delivery unavailable');},onFailure:async()=>{failed++;}},script:'export const meta={name:"complete",description:"Separate delivery failure"};return agent("work");',agent:async()=>{calls++;return {result:42,outputTokens:1};}});
  assert.equal(output.result,42);assert.equal(calls,1);assert.equal(completed,1);assert.equal(failed,0);assert.equal(observed,'completed');
  const events=(await readFile(join(f.runDir,'journal.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(event=>event.type==='run-finished').length,1);assert.equal(events.filter(event=>event.type==='run-failed').length,0);assert.equal(events.filter(event=>event.type==='notification-failed').length,1);
  const status=await readRunStatus(f.runDir);assert.equal(status.state,'completed');assert.match(status.notificationErrors[0],/completion delivery unavailable/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('the failure journal is terminal before failure delivery and delivery errors preserve the original task error',async()=>{
 const f=await fixture(),original=Error('original task failure');let calls=0,completed=0,failed=0,observed;
 try{
  await assert.rejects(runWorkflow({...f,hostContext:{id:'origin',revision:'1',onComplete:async()=>{completed++;},onFailure:async payload=>{failed++;observed=await readRunStatus(f.runDir);assert.equal(payload.error,original.message);throw Error('failure delivery unavailable');}},script:'export const meta={name:"fail",description:"Separate original failure"};return agent("work");',agent:async()=>{calls++;throw original;}}),error=>error===original);
  assert.equal(calls,1);assert.equal(completed,0);assert.equal(failed,1);assert.equal(observed.state,'failed');assert.match(observed.error,/original task failure/);
  const status=await readRunStatus(f.runDir);assert.equal(status.state,'failed');assert.match(status.error,/original task failure/);assert.match(status.notificationErrors[0],/failure delivery unavailable/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
