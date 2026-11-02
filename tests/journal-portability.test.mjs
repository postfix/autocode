import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runAutocode} from '../scripts/autocode.mjs';
test('exported and imported journals replay completed answers',async()=>{
 await fc.assert(fc.asyncProperty(fc.stringMatching(/^[a-z]{1,4}$/),async value=>{
  const root=await mkdtemp(join(tmpdir(),'portable-journal-'));
  try {
   const script=join(root,'workflow.js'),original=join(root,'original'),snapshot=join(root,'snapshot'),restored=join(root,'restored');
   await writeFile(script,'export const meta={name:"portable",description:"portable"};return agent(args);');
   await runAutocode(['run',script,'--args',JSON.stringify(value),'--run-dir',original],{codex:async prompt=>({result:prompt,outputTokens:1})});
   await runAutocode(['export','--run-dir',original,'--to',snapshot]);
   const imported=await runAutocode(['import','--from',snapshot,'--run-dir',restored]);
   const resumed=await runAutocode(['run',script,'--args',JSON.stringify(value),'--run-dir',restored,'--resume',imported.runId],{codex:async()=>{throw Error('completed answer must replay');}});
   assert.equal(resumed.result,value);
  }finally{await rm(root,{recursive:true,force:true});}
 }),{seed:42,numRuns:3});
});
