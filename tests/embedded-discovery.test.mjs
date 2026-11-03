import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),cli=fileURLToPath(new URL('../scripts/autocode.mjs',import.meta.url));
const runtime=new URL('../scripts/runtime.mjs',import.meta.url).href;

test('ps discovers an embedded workflow outside the project run directory and removes it after completion',async()=>{
 const root=await mkdtemp(fileURLToPath(new URL('../.scratch/embedded-',import.meta.url))),project=join(root,'project'),runDir=join(root,'external-run');
 await mkdir(project);let child;
 try{
  child=spawn(process.execPath,['--input-type=module','-e',`import {runWorkflow} from ${JSON.stringify(runtime)};
   await runWorkflow({cwd:process.env.PROJECT,runDir:process.env.RUN_DIR,script:'export const meta={name:"embedded-review",description:"embedded review"};phase("Verify");return agent("check");',agent:async()=>{process.send({ready:true});await new Promise(resolve=>process.once('message',resolve));return {result:'done',outputTokens:1};}});`],{cwd:project,env:{...process.env,PROJECT:project,RUN_DIR:runDir},stdio:['ignore','pipe','pipe','ipc']});
  let errors='';child.stderr.on('data',chunk=>errors+=chunk);
  const closed=new Promise(resolve=>child.once('close',resolve));
  await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('exit',code=>reject(Error(`embedded child exited ${code}: ${errors}`)));});
  const runs=JSON.parse((await exec(process.execPath,[cli,'ps','--json'],{cwd:project})).stdout);
  assert.equal(runs.length,1,'a live embedded workflow must be visible to ps');
  assert.equal(runs[0].name,'embedded-review');assert.equal(runs[0].state,'running');assert.equal(runs[0].phase,'Verify');
  const listing=(await exec(process.execPath,[cli,'ps'],{cwd:project})).stdout;
  assert.match(listing,/\bhost\b/,'human ps must distinguish host controls from CLI process controls');
  await assert.rejects(exec(process.execPath,[cli,'pause',runs[0].runId],{cwd:project}),/controlled by its host/);
  const status=JSON.parse((await exec(process.execPath,[cli,'status',runs[0].runId,'--json'],{cwd:project})).stdout);
  assert.equal(status.state,'running');assert.equal(status.pid,child.pid);assert.equal(status.controllable,false);
  child.send('finish');assert.equal(await closed,0,errors);
  assert.deepEqual(JSON.parse((await exec(process.execPath,[cli,'ps','--json'],{cwd:project})).stdout),[]);
 }finally{child?.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
});

test('an embedded run cannot be resumed concurrently or have its live journal overwritten',async()=>{
 const {readFile}=await import('node:fs/promises');
 const root=await mkdtemp(fileURLToPath(new URL('../.scratch/embedded-owner-',import.meta.url))),project=join(root,'project'),runDir=join(root,'run');
 await mkdir(project);let child;
 try{
  child=spawn(process.execPath,['--input-type=module','-e',`import {runWorkflow} from ${JSON.stringify(runtime)};await runWorkflow({cwd:process.env.PROJECT,runDir:process.env.RUN_DIR,script:'export const meta={name:"owner",description:"owner"};return agent("wait");',agent:async()=>{process.send('ready');await new Promise(resolve=>process.once('message',resolve));return {result:'done',outputTokens:0};}});`],{cwd:project,env:{...process.env,PROJECT:project,RUN_DIR:runDir},stdio:['ignore','pipe','pipe','ipc']});
  const closed=new Promise(resolve=>child.once('close',resolve));
  await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('exit',code=>reject(Error(`owner exited ${code}`)));});
  const saved=JSON.parse(await readFile(join(runDir,'run.json'),'utf8')),before=await readFile(join(runDir,'journal.jsonl'),'utf8');
  await assert.rejects(exec(process.execPath,['--input-type=module','-e',`import {runWorkflow} from ${JSON.stringify(runtime)};await runWorkflow({cwd:${JSON.stringify(project)},runDir:${JSON.stringify(runDir)},resumeFromRunId:${JSON.stringify(saved.runId)},script:${JSON.stringify(saved.script)},agent:async()=>({result:'wrong owner',outputTokens:0})});`],{cwd:project}),/workflow is still running/i);
  assert.equal(await readFile(join(runDir,'journal.jsonl'),'utf8'),before,'rejected takeover must not modify the active journal');
  child.kill('SIGKILL');await closed;
  const status=JSON.parse((await exec(process.execPath,[cli,'status',saved.runId,'--json'],{cwd:project})).stdout);
  assert.equal(status.state,'interrupted');
  assert.deepEqual(JSON.parse((await exec(process.execPath,[cli,'ps','--json'],{cwd:project})).stdout),[]);
 }finally{child?.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
});
