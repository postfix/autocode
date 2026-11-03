import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';

test('parent progress contains a bounded task label instead of replaying the agent prompt body',async()=>{
 await fc.assert(fc.asyncProperty(fc.integer({min:512,max:4096}),fc.boolean(),async(length,fail)=>{
  const runDir=await mkdtemp(join(tmpdir(),'progress-context-')),events=[];
  try{
   const output=await runWorkflow({runDir,args:{prompt:'Review current finding\nHISTORICAL_TOOL_DUMP_'+ 'x'.repeat(length)},script:'export const meta={name:"progress",description:"Compact parent progress"};try{return await agent(args.prompt)}catch{return "failed"}',onProgress:event=>events.push(event),agent:async()=>{if(fail)throw Error('seeded failure');return {result:'compact result',outputTokens:1};}});
   assert.equal(output.result,fail?'failed':'compact result');
   const calls=events.filter(event=>event.type.startsWith('agent-'));
   assert.equal(calls.length,2);
   for(const event of calls){assert.equal(event.label,'Review current finding');assert.ok(event.label.length<=160);}
  }finally{await rm(runDir,{recursive:true,force:true});}
 }),{seed:20261103,numRuns:12});
});
