import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {runWorkflow} from '../scripts/runtime.mjs';
import {readRunStatus} from '../scripts/run-stats.mjs';
import {controlRun} from '../scripts/run-control.mjs';

const exec=promisify(execFile),cli=fileURLToPath(new URL('../scripts/autocode.mjs',import.meta.url));
const runtime=new URL('../scripts/runtime.mjs',import.meta.url).href;
const scratch=fileURLToPath(new URL('../.scratch/',import.meta.url));
async function fixture(){await mkdir(scratch,{recursive:true});const root=await mkdtemp(join(scratch,'ownership-')),project=join(root,'project'),runDir=join(root,'run');await mkdir(project);return {root,project,runDir};}
async function invoke(project,args){return exec(process.execPath,[cli,...args],{cwd:project,timeout:10000});}
async function scriptFile(project,name,body){const file=join(project,name+'.js');await writeFile(file,`export const meta={name:${JSON.stringify(name)},description:"Ownership transition"};${body}`);return file;}
async function reference(project,id){return JSON.parse(await readFile(join(project,'.autocode/runs',id+'.json'),'utf8'));}
function embedded(project,runDir,resume){
 const child=spawn(process.execPath,['--input-type=module','-e',`import {runWorkflow} from ${JSON.stringify(runtime)};
 try{await runWorkflow({cwd:process.env.EVAL_PROJECT,runDir:process.env.EVAL_RUN_DIR,resumeFromRunId:process.env.EVAL_RESUME||undefined,
 script:'export const meta={name:"embedded",description:"Ownership transition"};return agent("hold");',
 agent:async()=>{process.send({ready:true});await new Promise(resolve=>process.once('message',resolve));return {result:'embedded-done',outputTokens:0};}});}catch(error){console.error(error.message);process.exitCode=1;}finally{if(process.connected)process.disconnect();}`],
 {cwd:project,env:{...process.env,EVAL_PROJECT:project,EVAL_RUN_DIR:runDir,EVAL_RESUME:resume??''},stdio:['ignore','pipe','pipe','ipc']});
 let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
 const closed=new Promise(resolve=>child.once('close',code=>resolve({code,stderr})));
 const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(Error('embedded readiness timed out'));},10000);
  const done=()=>{cleanup();resolve();},exit=code=>{cleanup();reject(Error(`embedded host exited ${code}: ${stderr}`));};
  function cleanup(){clearTimeout(timer);child.removeListener('message',done);child.removeListener('exit',exit);}
  child.once('message',done);child.once('exit',exit);
 });
 return {child,closed,ready,async finish(){if(child.connected)child.send('finish');return closed;},async stop(){if(child.exitCode===null)child.kill('SIGKILL');await closed;}};
}
async function until(fn){for(let i=0;i<1000;i++){if(await fn())return;await delay(5);}throw Error('CLI readiness timed out');}

test('a terminal CLI workflow resumed by an embedded host is discoverable as running and host-controlled',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();let host;
 try{
  const script=await scriptFile(f.project,'first','return "first-done";');
  const first=JSON.parse((await invoke(f.project,['run',script,'--cwd',f.project,'--run-dir',f.runDir])).stdout);
  host=embedded(f.project,f.runDir,first.runId);await host.ready;
  const runs=JSON.parse((await invoke(f.project,['ps','--json'])).stdout);
  assert.equal(runs.length,1,'the embedded resume must replace the terminal supervisor ownership');
  assert.equal(runs[0].runId,first.runId);assert.equal(runs[0].state,'running');assert.equal(runs[0].controllable,false);assert.equal(runs[0].pid,host.child.pid);
  assert.equal((await reference(f.project,first.runId)).kind,'embedded');
  const status=JSON.parse((await invoke(f.project,['status',first.runId,'--json'])).stdout);assert.equal(status.state,'running');assert.equal(status.controllable,false);
  assert.equal((await host.finish()).code,0);
 }finally{await host?.stop();await rm(f.root,{recursive:true,force:true});}
});

test('a completed embedded workflow resumed by the CLI acquires supervised discovery and controls',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();let host;
 try{
  host=embedded(f.project,f.runDir);await host.ready;
  const id=JSON.parse(await readFile(join(f.runDir,'run.json'),'utf8')).runId;
  assert.equal((await host.finish()).code,0);
  const script=await scriptFile(f.project,'cli-resume','return "cli-done";');
  const output=JSON.parse((await invoke(f.project,['run',script,'--cwd',f.project,'--run-dir',f.runDir,'--resume',id])).stdout);
  assert.equal(output.result,'cli-done');assert.equal(output.runId,id);
  const status=await readRunStatus(f.runDir);assert.equal(status.state,'completed');assert.equal(status.controllable,true);
  assert.notEqual((await reference(f.project,id)).kind,'embedded','registration must follow the current supervised owner');
 }finally{await host?.stop();await rm(f.root,{recursive:true,force:true});}
});

test('an external embedded resume cannot alter the journal of a live supervised CLI workflow',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();let child,closed;
 try{
  const script=await scriptFile(f.project,'live-cli','phase("OwnershipReady");await new Promise(()=>{});');
  child=spawn(process.execPath,[cli,'run',script,'--cwd',f.project,'--run-dir',f.runDir],{cwd:f.project,stdio:['ignore','pipe','pipe']});
  child.stdout.resume();child.stderr.resume();closed=new Promise(resolve=>child.once('close',resolve));
  await until(async()=>(await readFile(join(f.runDir,'journal.jsonl'),'utf8').catch(()=>'' )).includes('OwnershipReady'));
  const id=JSON.parse(await readFile(join(f.runDir,'run.json'),'utf8')).runId,before=await readFile(join(f.runDir,'journal.jsonl'),'utf8');
  await assert.rejects(runWorkflow({cwd:f.project,runDir:f.runDir,resumeFromRunId:id,script:'export const meta={name:"intruder",description:"Blocked resume"};return "must-not-execute";',agent:async()=>({result:'unused',outputTokens:0})}),/running|supervis|controller/i);
  assert.equal(await readFile(join(f.runDir,'journal.jsonl'),'utf8'),before,'rejected resume must not append or repair the active journal');
 }finally{if(child){await controlRun(f.runDir,'cancel').catch(()=>{});if(child.exitCode===null)child.kill('SIGKILL');await closed;}await rm(f.root,{recursive:true,force:true});}
});

test('a CLI resume cannot publish a supervisor or alter a live embedded workflow',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();let host;
 try{
  host=embedded(f.project,f.runDir);await host.ready;
  const id=JSON.parse(await readFile(join(f.runDir,'run.json'),'utf8')).runId,before=await readFile(join(f.runDir,'journal.jsonl'),'utf8');
  const script=await scriptFile(f.project,'blocked-cli','return "must-not-execute";');
  await assert.rejects(invoke(f.project,['run',script,'--cwd',f.project,'--run-dir',f.runDir,'--resume',id]),/running|embedded|controller/i);
  assert.equal(await readFile(join(f.runDir,'journal.jsonl'),'utf8'),before);
  await assert.rejects(readFile(join(f.runDir,'control.json'),'utf8'),{code:'ENOENT'});
  const status=await readRunStatus(f.runDir);assert.equal(status.state,'running');assert.equal(status.controllable,false);assert.equal(status.pid,host.child.pid);
 }finally{await host?.stop();await rm(f.root,{recursive:true,force:true});}
});
