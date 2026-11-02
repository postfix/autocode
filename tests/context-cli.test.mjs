import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runAutocode} from '../scripts/autocode.mjs';
test('CLI context supplies provider defaults without putting them in workflow source',async()=>{
 const root=await mkdtemp(join(tmpdir(),'context-cli-'));
 try {
  const script=join(root,'workflow.js'),context=join(root,'context.json');
  await writeFile(script,'export const meta={name:"context",description:"context"};return agent("inspect");');
  await writeFile(context,JSON.stringify({id:'session',revision:'1',providers:{codex:{model:'host-model',effort:'high'}}}));
  const output=await runAutocode(['run',script,'--context',context,'--run-dir',join(root,'run')],{codex:async(_prompt,opts)=>({result:opts.model,outputTokens:0})});
  assert.equal(output.result,'host-model');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('changing CLI permission mode invalidates cached agent results',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sandbox-replay-'));
 try {
  const script=join(root,'workflow.js'),runDir=join(root,'run');
  await writeFile(script,'export const meta={name:"sandbox",description:"sandbox"};return agent("inspect");');
  const adapters={codex:async(_p,opts)=>({result:opts.sandbox,outputTokens:0})};
  const first=await runAutocode(['run',script,'--run-dir',runDir],adapters);
  const resumed=await runAutocode(['run',script,'--run-dir',runDir,'--resume',first.runId,'--sandbox','workspace-write'],adapters);
  assert.equal(resumed.result,'workspace-write');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('saved workflow discovery exposes usage metadata without executing scripts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workflow-discovery-'));
 try {
  const directory=join(root,'.codex','workflows');await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'review.js'),'export const meta={name:"Review",description:"Review files",whenToUse:"Review changes"};throw Error("must not execute during discovery");');
  const entries=await runAutocode(['workflows','--cwd',root,'--json']);
  assert.deepEqual(entries.map(({name,whenToUse,reference})=>({name,whenToUse,reference})),[{name:'Review',whenToUse:'Review changes',reference:'review'}]);
 }finally{await rm(root,{recursive:true,force:true});}
});
