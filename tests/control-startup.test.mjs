import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import fc from 'fast-check';
import {superviseRun} from '../scripts/run-control.mjs';

test('controller metadata becomes visible only as a complete JSON document', {skip:process.platform!=='linux'},async()=>{
 const scratch=fileURLToPath(new URL('../.scratch/',import.meta.url));await mkdir(scratch,{recursive:true});
 await fc.assert(fc.asyncProperty(fc.integer({min:524288,max:1048576}),async length=>{
  const runDir=await mkdtemp(join(scratch,'control-startup-'));let ended=false,reads=0;const invalid=[];
  const pending=superviseRun([process.execPath,'-e','setTimeout(()=>{},60)'],{runDir,provider:'x'.repeat(length),forwardOutput:false,controlTransport:'file'});
  const observed=pending.finally(()=>{ended=true;});
  try{
   while(!ended){
    try{const value=await readFile(join(runDir,'control.json'),'utf8');reads++;try{JSON.parse(value);}catch(error){invalid.push(error.message);}}
    catch(error){if(error.code!=='ENOENT')throw error;}
   }
   await observed;assert.ok(reads>0);assert.deepEqual(invalid,[],'readers must never observe partially published metadata');
  }finally{await observed.catch(()=>{});await rm(runDir,{recursive:true,force:true});}
 }),{numRuns:2,seed:20261102});
});
