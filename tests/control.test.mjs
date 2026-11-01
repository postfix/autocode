import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runAutocode} from '../scripts/autocode.mjs';
import {runWorkflow} from '../scripts/runtime.mjs';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';

test('status includes phases, tokens and errors even when a workflow catches its failed agent', async () => {
  const dir=await mkdtemp(join(tmpdir(),'autocode-status-'));
  try {
    await runWorkflow({runDir:dir,script:'export const meta={name:"inspect",description:"Inspect"}; phase("Verify");try{await agent("bad",{label:"verifier",model:"small",provider:"codex"})}catch{}return await agent("good",{label:"repair"});',agent:async(prompt,_opts,context)=>{
      if(prompt==='bad'){context.onActivity?.({tool:'command',status:'failed',exitCode:2,message:'test failed'});throw Error('provider unavailable; api_key=SECRET_VALUE');}
      return {result:'fixed',outputTokens:7};
    }});
    const status=await runAutocode(['status','--run-dir',dir,'--json']);
    assert.equal(status.state,'completed');assert.equal(status.name,'inspect');
    assert.equal(status.outputTokens,7);assert.equal(status.agents.length,2);
    assert.equal(status.agents[0].phase,'Verify');assert.equal(status.agents[0].label,'verifier');
    assert.equal(status.agents[0].state,'failed');assert.equal(status.agents[0].activity[0].exitCode,2);
    assert.match(status.agents[0].error,/provider unavailable/);assert.doesNotMatch(JSON.stringify(status),/SECRET_VALUE/);
    assert.equal(status.agents[1].state,'completed');assert.equal(status.errorCount,2);
    const text=await runAutocode(['status','--run-dir',dir]);assert.match(text,/verifier/);assert.match(text,/test failed/);assert.match(text,/provider unavailable/);
    const detail=await runAutocode(['status','--run-dir',dir,'--agent','1','--json']);assert.equal(detail.agents.length,1);assert.equal(detail.agents[0].label,'verifier');
    await assert.rejects(runAutocode(['status','--run-dir',dir,'--agent','999']),/not in the retained view/);
    await assert.rejects(runAutocode(['cancel','--run-dir',dir,'--agent','1']),/only available for status/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('top-level program errors remain inspectable after the program exits', async () => {
  const dir=await mkdtemp(join(tmpdir(),'autocode-error-'));
  try {
    await assert.rejects(runWorkflow({runDir:dir,script:'export const meta={name:"broken",description:"Fail"};throw Error("broken workflow")',agent:async()=>{}}),/broken workflow/);
    const status=await runAutocode(['status','--run-dir',dir,'--json']);
    assert.equal(status.state,'failed');assert.match(status.error,/broken workflow/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<200;i++){try{const result=await fn();if(result)return result;}catch{}await delay(10);}throw Error('condition not reached');}

test('project commands discover custom runs, require a choice for multiple runs, and select the only active run', {skip:process.platform!=='linux'}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),'autocode-project-')),project=join(dir,'project'),other=join(dir,'other'),custom=join(dir,'custom');
  await mkdir(project);await mkdir(other);
  const cli=fileURLToPath(new URL('../scripts/autocode.mjs',import.meta.url)),script=join(dir,'workflow.js'),children=[];
  await writeFile(script,'export const meta={name:"lane",description:"A running lane"};phase("Build");for(;;)await new Promise(r=>setTimeout(r,10));');
  const invoke=(args,cwd=project)=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,[cli,...args],{cwd,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',code=>resolve({code,out,err}));});
  const command=async(args,cwd)=>{const r=await invoke([...args,'--json'],cwd);assert.equal(r.code,0,r.err);return JSON.parse(r.out);};
  const start=flags=>{const p=spawn(process.execPath,[cli,'run',script,'--cwd',project,...flags],{cwd:other,stdio:'ignore'});children.push({p,closed:new Promise(r=>p.once('close',r))});};
  try{
    assert.deepEqual(await command(['ps']),[]);
    start(['--run-dir',custom]);
    const first=await until(async()=>{const rows=await command(['ps']);return rows.length===1&&rows[0].phase==='Build'&&rows[0];});
    assert.match(first.runId,/^wf_/);assert.equal(first.runDir,custom);
    const duplicate=await invoke(['run',script,'--run-dir',custom]);
    assert.notEqual(duplicate.code,0);assert.match(duplicate.err,/already belongs/);
    assert.equal((await command(['status',first.runId])).state,'running','a rejected restart cannot overwrite the live ID');
    assert.equal((await command(['status'])).runId,first.runId);
    assert.deepEqual(await command(['ps'],other),[],'--cwd selects the owning project, not the launch directory');
    assert.notEqual((await invoke(['pause',first.runId],other)).code,0,'another project cannot select this ID');
    assert.equal((await command(['pause'])).state,'paused');
    assert.equal((await command(['ps']))[0].state,'paused','paused programs remain manageable');
    assert.equal((await command(['resume',first.runId])).state,'running');
    start([]);
    const rows=await until(async()=>{const r=await command(['ps']);return r.length===2&&r.every(x=>x.phase==='Build')&&r;});
    const second=rows.find(x=>x.runId!==first.runId);
    assert.ok(second.runDir.startsWith(join(project,'.codex','autocode-runs')));
    for(const verb of ['status','pause','resume','cancel']){
      const choice=await command([verb]);assert.equal(choice.state,'selection-required');
      assert.deepEqual(choice.workflows.map(x=>x.runId).sort(),rows.map(x=>x.runId).sort());
      assert.match(choice.question,/Which workflow/);
    }
    const prompt=await invoke(['cancel']);assert.match(prompt.out,/Which workflow/);assert.match(prompt.out,new RegExp(first.runId));
    assert.ok((await command(['ps'])).every(x=>x.state==='running'),'ambiguous commands never change either program');
    assert.equal((await command(['pause',second.runId])).state,'paused');
    assert.equal((await command(['status',first.runId])).state,'running');
    assert.equal((await command(['cancel',second.runId])).state,'cancelled');
    assert.equal((await command(['status',second.runId])).state,'cancelled','finished runs remain inspectable by ID');
    const restart=await invoke(['run',script,'--run-dir',second.runDir]);
    assert.notEqual(restart.code,0);assert.match(restart.err,/already belongs/);
    assert.equal((await command(['status',second.runId])).state,'cancelled','a rejected restart preserves historical registration');
    assert.equal((await command(['ps'])).length,1);
    await rm(second.runDir,{recursive:true,force:true});
    assert.equal((await command(['ps'])).length,1,'removed historical run directories do not block live controls');
    const broken=join(dir,'broken.js'),brokenDir=join(dir,'broken-run');
    await writeFile(broken,'export const meta={name:"broken",description:"Fail"};throw Error("broken program");');
    assert.equal((await invoke(['run',broken,'--run-dir',brokenDir])).code,1);
    const brokenId=JSON.parse(await readFile(join(brokenDir,'control.json'),'utf8')).runId;
    assert.match((await command(['status',brokenId])).error,/broken program/);
    assert.equal((await command(['ps'])).length,1,'failed programs stay inspectable without appearing as running');
    assert.equal((await command(['cancel'])).state,'cancelled','the remaining active workflow is selected automatically');
    assert.deepEqual(await command(['ps']),[]);
    assert.match((await invoke(['pause'])).out,/No active Autocode workflows/);
    assert.notEqual((await invoke(['cancel','missing-id'])).code,0);
    for(const child of children)assert.equal(await child.closed,130);
  }finally{
    for(const child of children){if(child.p.exitCode===null){const listing=await command(['ps']).catch(()=>[]);for(const row of listing)await invoke(['cancel',row.runId]);if(child.p.exitCode===null)child.p.kill();}await child.closed;}
    await rm(dir,{recursive:true,force:true});
  }
});

test('pause freezes the current program and a detached child; resume keeps PIDs; cancel terminates both', {skip:process.platform!=='linux'}, async () => {
  const {superviseRun,controlRun}=await import('../scripts/run-control.mjs');
  const dir=await mkdtemp(join(tmpdir(),'autocode-control-'));
  const fixture=join(dir,'program.mjs');
  const program=`import fs from 'node:fs';import {spawn} from 'node:child_process';
const dir=process.argv[2];fs.writeFileSync(dir+'/parent.pid',String(process.pid));
const child=spawn(process.execPath,['-e',"const fs=require('fs');let n=0;setInterval(()=>fs.writeFileSync(process.argv[1],String(++n)),10)",dir+'/child.count'],{detached:true,stdio:'ignore'});
fs.writeFileSync(dir+'/child.pid',String(child.pid));let n=0;setInterval(()=>fs.writeFileSync(dir+'/parent.count',String(++n)),10);`;
  await writeFile(fixture,program);
  let finished;
  try {
    finished=superviseRun([process.execPath,fixture,dir],{runDir:dir,provider:'codex',forwardOutput:false});
    await until(()=>readFile(join(dir,'child.count'),'utf8'));
    await assert.rejects(superviseRun([process.execPath,fixture,dir],{runDir:dir,forwardOutput:false}),/already has a controller/);
    const pids=await Promise.all(['parent','child'].map(name=>readFile(join(dir,name+'.pid'),'utf8')));
    assert.equal((await controlRun(dir,'pause')).state,'paused');
    const before=await Promise.all(['parent','child'].map(name=>readFile(join(dir,name+'.count'),'utf8')));
    await delay(100);
    assert.deepEqual(await Promise.all(['parent','child'].map(name=>readFile(join(dir,name+'.count'),'utf8'))),before,'both running programs must actually stop advancing');
    assert.equal((await controlRun(dir,'resume')).state,'running');
    await until(async()=>await readFile(join(dir,'parent.count'),'utf8')!==before[0]);
    assert.deepEqual(await Promise.all(['parent','child'].map(name=>readFile(join(dir,name+'.pid'),'utf8'))),pids,'resume continues the same processes');
    await controlRun(dir,'pause');
    const owner=JSON.parse(await readFile(join(dir,'control.json'),'utf8'));
    const refused=await new Promise((resolve,reject)=>{const socket=net.createConnection(owner.endpoint);let text='';socket.on('error',reject);socket.on('connect',()=>socket.write(JSON.stringify({command:'cancel',token:'wrong-token'})+'\n'));socket.on('data',chunk=>text+=chunk);socket.on('end',()=>resolve(JSON.parse(text)));});
    assert.match(refused.error,/invalid.*token/);assert.equal((await controlRun(dir,'status')).state,'paused');
    assert.equal((await controlRun(dir,'cancel')).state,'cancelled');
    assert.equal((await finished).state,'cancelled');
    for(const pid of pids) await until(async()=>{try{const s=await readFile('/proc/'+pid+'/stat','utf8');return s.slice(s.lastIndexOf(')')+2).startsWith('Z');}catch(e){return e.code==='ENOENT';}});
  } finally {await controlRun(dir,'cancel').catch(()=>{});if(finished)await finished.catch(()=>{});await rm(dir,{recursive:true,force:true});}
});

test('CLI commands control a running workflow and its paused program, then resume its retained journal', {skip:process.platform!=='linux'}, async () => {
  const dir=await mkdtemp(join(tmpdir(),'autocode-cli-control-')),runDir=join(dir,'run'),script=join(dir,'workflow.js');
  const cli=fileURLToPath(new URL('../scripts/autocode.mjs',import.meta.url));
  const invoke=args=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,[cli,...args],{cwd:dir,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',code=>resolve({code,out,err}));});
  await writeFile(script,'export const meta={name:"live",description:"Observe live program"};phase("Build");for(let n=0;;n++){log("tick"+n);await new Promise(r=>setTimeout(r,10));}');
  let child,closed;
  try {
    child=spawn(process.execPath,[cli,'run',script,'--run-dir',runDir],{cwd:dir,stdio:'ignore'});
    closed=new Promise(resolve=>child.on('close',resolve));
    const status=await until(async()=>{const result=await invoke(['status','--run-dir',runDir,'--json']);return result.code===0&&JSON.parse(result.out).phase==='Build'&&JSON.parse(result.out);});
    assert.equal((await invoke(['pause','--run-dir',runDir])).code,0);
    const before=await readFile(join(runDir,'journal.jsonl'),'utf8');await delay(80);assert.equal(await readFile(join(runDir,'journal.jsonl'),'utf8'),before);
    assert.equal(JSON.parse((await invoke(['status','--run-dir',runDir,'--json'])).out).state,'paused');
    assert.equal((await invoke(['resume','--run-dir',runDir])).code,0);
    await until(async()=>await readFile(join(runDir,'journal.jsonl'),'utf8')!==before);
    assert.equal(JSON.parse((await invoke(['status','--run-dir',runDir,'--json'])).out).pid,status.pid);
    assert.equal((await invoke(['cancel','--run-dir',runDir])).code,0);assert.equal(await closed,130);
    assert.equal(JSON.parse((await invoke(['status','--run-dir',runDir,'--json'])).out).state,'cancelled');
    await writeFile(script,'export const meta={name:"live",description:"Finish retained run"};return 7;');
    const resumed=await invoke(['run',script,'--run-dir',runDir,'--resume',status.runId]);
    assert.equal(resumed.code,0,resumed.err);assert.equal(JSON.parse(resumed.out).result,7);
    assert.equal(JSON.parse((await invoke(['status','--run-dir',runDir,'--json'])).out).state,'completed');
  }finally{await runAutocode(['cancel','--run-dir',runDir]).catch(()=>{});if(child&&child.exitCode===null)child.kill();if(closed)await closed;await rm(dir,{recursive:true,force:true});}
});

test('control refuses forged tokens and an unavailable owner without signalling a stored PID', async () => {
  const {controlRun}=await import('../scripts/run-control.mjs');
  const dir=await mkdtemp(join(tmpdir(),'autocode-stale-'));
  try {
    await writeFile(join(dir,'control.json'),JSON.stringify({version:1,state:'running',pid:process.pid,endpoint:join(dir,'missing.sock'),token:'invalid'}));
    await assert.rejects(controlRun(dir,'cancel'),/unavailable/);
    assert.equal(process.kill(process.pid,0),true);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('a program launch error is recorded and releases the controller lock', {skip:process.platform!=='linux'}, async()=>{
  const {superviseRun}=await import('../scripts/run-control.mjs');
  const dir=await mkdtemp(join(tmpdir(),'autocode-launch-error-'));
  try{
    await assert.rejects(superviseRun(['/autocode-nonexistent-program'],{runDir:dir,forwardOutput:false}),/ENOENT/);
    const status=await runAutocode(['status','--run-dir',dir,'--json']);assert.equal(status.state,'failed');assert.match(status.error,/ENOENT/);
    await assert.rejects(readFile(join(dir,'controller.lock')),/ENOENT/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
