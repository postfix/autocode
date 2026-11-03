import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';
const script='export const meta={name:"budget-contract",description:"budget-contract"};return agent("inspect");';
test('invalid shared spent values cannot admit an adapter call',async()=>{
 for(const total of [0,null])for(const value of [Promise.resolve(0),NaN,Infinity,-1,0.5]){
  const runDir=await mkdtemp(join(tmpdir(),'host-budget-contract-'));let calls=0;
  try{await assert.rejects(runWorkflow({script,runDir,hostContext:{id:'host',revision:'1',budget:{total,spent:()=>value,charge:()=>{}}},agent:async()=>{calls++;return {result:'unexpected',outputTokens:0};}}),/host budget spent\(\) must synchronously return a non-negative safe integer/);assert.equal(calls,0);}finally{await rm(runDir,{recursive:true,force:true});}
 }
});

test('known asynchronous charge callbacks are rejected before adapter startup',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'host-charge-contract-'));let calls=0;
 try{await assert.rejects(runWorkflow({script,runDir,hostContext:{id:'host',revision:'1',budget:{total:1,spent:()=>0,charge:async()=>{}}},agent:async()=>{calls++;return {result:'unexpected',outputTokens:1};}}),/host budget charge\(\) must be synchronous/);assert.equal(calls,0);}finally{await rm(runDir,{recursive:true,force:true});}
});

test('a charge callback returning a thenable fails the run and prevents further admission',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'host-charge-thenable-'));let calls=0;
 try{await assert.rejects(runWorkflow({script:'export const meta={name:"charge",description:"charge"};try{await agent("first")}catch{}return agent("second");',runDir,hostContext:{id:'host',revision:'1',budget:{total:1,spent:()=>0,charge:()=>Promise.resolve()}},agent:async()=>{calls++;return {result:'answer',outputTokens:1};}}),/host budget charge\(\) must be synchronous/);assert.equal(calls,1);}finally{await rm(runDir,{recursive:true,force:true});}
});

test('workflow error handling cannot conceal an invalid shared charge contract',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'host-charge-caught-'));
 try{await assert.rejects(runWorkflow({script:'export const meta={name:"charge",description:"charge"};try{await agent("first")}catch{}return "continued";',runDir,hostContext:{id:'host',revision:'1',budget:{total:1,spent:()=>0,charge:()=>Promise.resolve()}},agent:async()=>({result:'answer',outputTokens:1})}),/host budget charge\(\) must be synchronous/);}finally{await rm(runDir,{recursive:true,force:true});}
});

test('rejected ledger promises are consumed while synchronous ledgers retain reported accounting',async()=>{
 for(const field of ['spent','charge']){
  const runDir=await mkdtemp(join(tmpdir(),'host-budget-rejected-'));
  const budget={total:1,spent:()=>0,charge:()=>{}};budget[field]=()=>Promise.reject(Error('asynchronous ledger failure'));
  try{await assert.rejects(runWorkflow({script,runDir,hostContext:{id:'host',revision:'1',budget},agent:async()=>({result:'answer',outputTokens:1})}),/host budget (spent|charge)\(\) must/);}finally{await rm(runDir,{recursive:true,force:true});}
 }
 const runDir=await mkdtemp(join(tmpdir(),'host-budget-valid-'));let spent=0;
 try{const output=await runWorkflow({script,runDir,hostContext:{id:'host',revision:'1',budget:{total:null,spent:()=>spent,charge:count=>spent+=count}},agent:async()=>({result:'answer',outputTokens:2})});assert.equal(output.result,'answer');assert.equal(output.outputTokens,2);assert.equal(spent,2);}finally{await rm(runDir,{recursive:true,force:true});}
});
