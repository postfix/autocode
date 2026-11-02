import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';
test('console messages are visible as workflow progress',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'console-parity-'));
 try {
  const output=await runWorkflow({runDir,script:'export const meta={name:"console",description:"console"};console.warn("check",42);return 1;',agent:async()=>{}});
  assert.deepEqual(output.logs,[{phase:null,message:'[warn] check 42'}]);
 }finally{await rm(runDir,{recursive:true,force:true});}
});
test('workflow console does not expose a host Function constructor',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'console-boundary-'));
 try {
  const output=await runWorkflow({runDir,script:'export const meta={name:"console",description:"console"};try{return console.constructor.constructor("return typeof process")()}catch{return "blocked"}',agent:async()=>{}});
  assert.equal(output.result,'blocked');
 }finally{await rm(runDir,{recursive:true,force:true});}
});
