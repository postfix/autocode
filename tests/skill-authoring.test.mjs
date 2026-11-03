import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';

test('the skill run-command arguments work with its first suggested template',async()=>{
 const skill=await readFile(new URL('../SKILL.md',import.meta.url),'utf8');
 const args=JSON.parse(/autocode run workflow\.js[^\n]*--args '([^']+)'/.exec(skill)[1]);
 const script=await readFile(new URL('../assets/templates/review-and-verify.js',import.meta.url),'utf8');
 const runDir=await mkdtemp(join(tmpdir(),'skill-authoring-'));
 try{
  const output=await runWorkflow({runDir,script,args,agent:async()=>({result:{findings:[]},outputTokens:0})});
  assert.deepEqual(output.result,[]);
  assert.deepEqual(output.failures,[]);
 }finally{await rm(runDir,{recursive:true,force:true});}
});
