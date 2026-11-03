import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,chmod,rm,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),cli=fileURLToPath(new URL('../scripts/autocode.mjs',import.meta.url)),runtime=new URL('../scripts/runtime.mjs',import.meta.url).href;
const scratch=fileURLToPath(new URL('../.scratch/',import.meta.url));
async function fixture(){await mkdir(scratch,{recursive:true});const root=await mkdtemp(join(scratch,'discovery-permissions-')),project=join(root,'project'),restricted=join(project,'.autocode'),runDir=join(root,'run');await mkdir(project);await mkdir(restricted);await chmod(restricted,0);return {root,project,restricted,runDir,env:{...process.env,XDG_STATE_HOME:join(root,'private-state')}};}

test('ps finds an IPC-held embedded workflow through fallback when the primary registry is unreadable',{skip:process.platform!=='linux'||process.getuid?.()===0},async()=>{
 const f=await fixture();let child,closed;
 try{
  child=spawn(process.execPath,['--input-type=module','-e',`import{runWorkflow}from${JSON.stringify(runtime)};try{await runWorkflow({cwd:process.env.EVAL_PROJECT,runDir:process.env.EVAL_RUN_DIR,script:'export const meta={name:"permission-fallback",description:"Discovery permission fallback"};return agent("hold");',agent:async()=>{process.send({ready:true});await new Promise(resolve=>process.once('message',resolve));return{result:'done',outputTokens:0};}});}catch(error){console.error(error.message);process.exitCode=1;}finally{if(process.connected)process.disconnect();}`],{cwd:f.project,env:{...f.env,EVAL_PROJECT:f.project,EVAL_RUN_DIR:f.runDir},stdio:['ignore','pipe','pipe','ipc']});
  let errors='';child.stdout.resume();child.stderr.on('data',chunk=>errors+=chunk);closed=new Promise(resolve=>child.once('close',code=>resolve({code,errors})));
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('embedded readiness timed out')),10000);child.once('message',()=>{clearTimeout(timer);resolve();});child.once('exit',code=>{clearTimeout(timer);reject(Error(`embedded host exited ${code}: ${errors}`));});});
  const {stdout,stderr}=await exec(process.execPath,[cli,'ps','--json'],{cwd:f.project,env:f.env,timeout:10000});
  const rows=JSON.parse(stdout);assert.equal(rows.length,1);assert.equal(rows[0].name,'permission-fallback');assert.equal(rows[0].state,'running');assert.equal(rows[0].pid,child.pid);assert.equal(rows[0].controllable,false);
  assert.match(stderr,/unreadable|permission|registry/i,'partial registry coverage must be visible rather than silently skipped');
  child.send('finish');assert.equal((await closed).code,0);
 }finally{if(child?.exitCode===null)child.kill('SIGKILL');await closed;await chmod(f.restricted,0o700);await rm(f.root,{recursive:true,force:true});}
});

test('an unreadable registry with no verified fallback rows fails explicitly rather than reporting idle',{skip:process.platform!=='linux'||process.getuid?.()===0},async()=>{
 const f=await fixture();
 try{await assert.rejects(exec(process.execPath,[cli,'ps','--json'],{cwd:f.project,env:f.env,timeout:10000}),error=>error.code!==0&&/permission|unreadable|EACCES|registry/i.test(error.stderr)&&!/^\s*\[\]\s*$/.test(error.stdout));}
 finally{await chmod(f.restricted,0o700);await rm(f.root,{recursive:true,force:true});}
});

test('a readable stale primary reference does not hide an embedded resume registered through readonly fallback',{skip:process.platform!=='linux'||process.getuid?.()===0},async()=>{
 const f=await fixture(),registry=join(f.project,'.autocode/runs');let child,closed;
 try{
  await chmod(f.restricted,0o700);
  const script=join(f.project,'first.js');await writeFile(script,'export const meta={name:"first",description:"First supervised run"};return "done";');
  const first=JSON.parse((await exec(process.execPath,[cli,'run',script,'--cwd',f.project,'--run-dir',f.runDir],{cwd:f.project,env:f.env,timeout:10000})).stdout);
  await chmod(registry,0o555);
  child=spawn(process.execPath,['--input-type=module','-e',`import{runWorkflow}from${JSON.stringify(runtime)};try{await runWorkflow({cwd:process.env.EVAL_PROJECT,runDir:process.env.EVAL_RUN_DIR,resumeFromRunId:process.env.EVAL_RESUME,script:'export const meta={name:"readonly-resume",description:"Readonly ownership transfer"};return agent("hold");',agent:async()=>{process.send({ready:true});await new Promise(resolve=>process.once('message',resolve));return{result:'done',outputTokens:0};}});}catch(error){console.error(error.message);process.exitCode=1;}finally{if(process.connected)process.disconnect();}`],{cwd:f.project,env:{...f.env,EVAL_PROJECT:f.project,EVAL_RUN_DIR:f.runDir,EVAL_RESUME:first.runId},stdio:['ignore','pipe','pipe','ipc']});
  let errors='';child.stdout.resume();child.stderr.on('data',chunk=>errors+=chunk);closed=new Promise(resolve=>child.once('close',code=>resolve({code,errors})));
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('embedded readiness timed out')),10000);child.once('message',()=>{clearTimeout(timer);resolve();});child.once('exit',code=>{clearTimeout(timer);reject(Error(`embedded host exited ${code}: ${errors}`));});});
  const stale=JSON.parse(await readFile(join(registry,first.runId+'.json'),'utf8'));assert.notEqual(stale.kind,'embedded','the readonly primary reference must remain stale for this regression');
  const {stdout}=await exec(process.execPath,[cli,'ps','--json'],{cwd:f.project,env:f.env,timeout:10000});
  const rows=JSON.parse(stdout);assert.equal(rows.length,1);assert.equal(rows[0].runId,first.runId);assert.equal(rows[0].name,'first');assert.equal(rows[0].state,'running');assert.equal(rows[0].controllable,false);assert.equal(rows[0].pid,child.pid);
  child.send('finish');assert.equal((await closed).code,0);
 }finally{if(child?.exitCode===null)child.kill('SIGKILL');await closed;await chmod(registry,0o700).catch(()=>{});await chmod(f.restricted,0o700);await rm(f.root,{recursive:true,force:true});}
});
