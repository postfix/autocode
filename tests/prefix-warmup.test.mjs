import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';

test('same-prefix siblings wait for first response rather than the first completed agent',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'prefix-warmup-'));
 let releaseFirst,firstContext,started=0;
 const firstFinished=new Promise(resolve=>{releaseFirst=resolve;});
 const pending=runWorkflow({runDir,script:'export const meta={name:"warmup",description:"warmup"};return parallel([()=>agent("first"),()=>agent("second")]);',agent:async(prompt,_opts,context)=>{
  started++;
  if(prompt==='first'){firstContext=context;await firstFinished;}
  return {result:prompt,outputTokens:0};
 }});
 try {
  while(!firstContext)await new Promise(resolve=>setTimeout(resolve,1));
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(started,1);
  firstContext.onResponse();
  while(started<2)await new Promise(resolve=>setTimeout(resolve,1));
  releaseFirst();
  assert.deepEqual((await pending).result,['first','second']);
 }finally{releaseFirst();await pending;await rm(runDir,{recursive:true,force:true});}
});

test('a failed warming leader releases its sibling without waiting for the cap',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'prefix-failure-'));
 let releaseFirst,firstStarted=false,secondStarted=false;
 const blocked=new Promise(resolve=>{releaseFirst=resolve;});
 const pending=runWorkflow({runDir,script:'export const meta={name:"failure",description:"failure"};return parallel([()=>agent("first"),()=>agent("second")]);',agent:async prompt=>{
  if(prompt==='first'){firstStarted=true;await blocked;throw Error('leader failed');}
  secondStarted=true;return {result:'second',outputTokens:0};
 }});
 try {
  while(!firstStarted)await new Promise(resolve=>setTimeout(resolve,1));
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(secondStarted,false);
  releaseFirst();
  const output=await Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(Error('leader did not release sibling')),500))]);
  assert.deepEqual(output.result,[null,'second']);
 }finally{releaseFirst();await pending;await rm(runDir,{recursive:true,force:true});}
});

test('different model prefixes can start while the first model is warming',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'prefix-model-'));
 let releaseFirst,started=0;
 const blocked=new Promise(resolve=>{releaseFirst=resolve;});
 const pending=runWorkflow({runDir,script:'export const meta={name:"models",description:"models"};return parallel([()=>agent("first",{model:"a"}),()=>agent("second",{model:"b"})]);',agent:async prompt=>{
  started++;if(prompt==='first')await blocked;return {result:prompt,outputTokens:0};
 }});
 try {
  for(let i=0;i<100&&started<2;i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(started,2);releaseFirst();await pending;
 }finally{releaseFirst();await pending;await rm(runDir,{recursive:true,force:true});}
});

test('a revised host prefix does not wait on its previous revision warming',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'prefix-revision-'));
 const hostContext={id:'host',revision:'1'};
 let releaseFirst,started=0;
 const blocked=new Promise(resolve=>{releaseFirst=resolve;});
 const script='export const meta={name:"revision",description:"revision"};return agent("request");';
 const agent=async()=>{started++;if(started===1)await blocked;return {result:'done',outputTokens:0};};
 const first=runWorkflow({runDir:join(runDir,'first'),script,hostContext,agent});
 let second;
 try {
  while(started===0)await new Promise(resolve=>setTimeout(resolve,1));
  hostContext.revision='2';
  second=runWorkflow({runDir:join(runDir,'second'),script,hostContext,agent});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(started,2);
 }finally{releaseFirst();await first;await second;await rm(runDir,{recursive:true,force:true});}
});
