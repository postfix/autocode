import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),cli=fileURLToPath(new URL('../scripts/autocode.mjs',import.meta.url));
test('CLI can skip one running agent while its workflow continues',async()=>{
 const root=await mkdtemp(join(tmpdir(),'agent-control-')),runDir=join(root,'run'),script=join(root,'workflow.js'),backend=join(root,'fake-codex.mjs');
 let child,closed,out='';
 try {
  await writeFile(script,'export const meta={name:"skip",description:"skip"};const result=await agent("wait");return {result,continued:true};');
  await writeFile(backend,'#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({type:"thread.started",thread_id:"fixture"})+"\\n");setInterval(()=>{},1000);');await chmod(backend,0o700);
  child=spawn(process.execPath,[cli,'run',script,'--run-dir',runDir,'--cwd',root,'--codex',backend],{stdio:['ignore','pipe','pipe']});child.stdout.on('data',chunk=>out+=chunk);child.stderr.resume();closed=new Promise(resolve=>child.once('close',resolve));
  let running=false;
  for(let n=0;n<100;n++){
   try {const state=JSON.parse((await exec(process.execPath,[cli,'status','--run-dir',runDir,'--json'])).stdout);if(state.agents.some(agent=>agent.state==='running')){running=true;break;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(running,true);
  await exec(process.execPath,[cli,'skip','--run-dir',runDir,'--agent','1']);
  assert.equal(await closed,0);
  assert.deepEqual(JSON.parse(out).result,{result:null,continued:true});
 }finally{await exec(process.execPath,[cli,'cancel','--run-dir',runDir]).catch(()=>{});if(child&&child.exitCode===null)child.kill();if(closed)await closed;await rm(root,{recursive:true,force:true});}
});
