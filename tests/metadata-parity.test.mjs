import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';

test('computed metadata is refused before running a workflow', async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'metadata-'));
 try {await assert.rejects(runWorkflow({runDir,script:'export const meta={name:(()=>"computed")(),description:"probe"};return 1;',agent:async()=>{throw Error('unexpected agent');}}),/pure literal/);}
 finally {await rm(runDir,{recursive:true,force:true});}
});
