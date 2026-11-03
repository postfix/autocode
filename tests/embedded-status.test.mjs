import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm,stat,chmod,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readRunStatus} from '../scripts/run-stats.mjs';

const runId='wf_11111111-1111-4111-8111-111111111111';
async function fixture(){
 const project=await mkdtemp(join(tmpdir(),'embedded-status-'));
 const runDir=join(project,'run');await mkdir(runDir);
 await writeFile(join(runDir,'run.json'),JSON.stringify({runId,name:'embedded',journalVersion:2}));
 await writeFile(join(runDir,'journal.jsonl'),JSON.stringify({type:'run-started',time:1})+'\n');
 return {project,runDir};
}

test('embedded status rejects a reused live PID whose start identity does not match',async()=>{
 const {project,runDir}=await fixture();
 try{
  await writeFile(join(runDir,'runner.json'),JSON.stringify({project,runDir,runId,pid:process.pid,processStart:'0'}));
  const status=await readRunStatus(runDir);
  assert.equal(status.state,'interrupted');
  assert.equal(status.controllable,false);
  assert.equal(status.pid,process.pid);
 }finally{await rm(project,{recursive:true,force:true});}
});

test('embedded registration publishes private owner and project records with verifiable live status',async()=>{
 const {registerEmbeddedRun}=await import('../scripts/run-stats.mjs');
 const {project,runDir}=await fixture();
 try{
  await registerEmbeddedRun({project,runDir,runId,cwd:project});
  const owner=JSON.parse(await readFile(join(runDir,'runner.json'),'utf8'));
  assert.deepEqual(Object.keys(owner).sort(),['project','runDir','runId','pid','processStart'].sort());
  assert.equal(owner.project,project);assert.equal(owner.runDir,runDir);assert.equal(owner.runId,runId);assert.equal(owner.pid,process.pid);assert.match(owner.processStart,/^\d+$/);
  assert.equal((await stat(join(runDir,'runner.json'))).mode&0o777,0o600);
  const reference=join(project,'.autocode','runs',`${runId}.json`);
  assert.deepEqual(JSON.parse(await readFile(reference,'utf8')),{project,runDir,kind:'embedded'});
  assert.equal((await stat(reference)).mode&0o777,0o600);
  const status=await readRunStatus(runDir);
  assert.equal(status.state,'running');assert.equal(status.controllable,false);assert.equal(status.pid,process.pid);
 }finally{await rm(project,{recursive:true,force:true});}
});

test('embedded status treats a dead owner with missing start identity as interrupted',async()=>{
 const {project,runDir}=await fixture();
 try{
  await writeFile(join(runDir,'runner.json'),JSON.stringify({project,runDir,runId,pid:2147483647}));
  const status=await readRunStatus(runDir);
  assert.equal(status.state,'interrupted');assert.equal(status.controllable,false);
 }finally{await rm(project,{recursive:true,force:true});}
});

test('embedded registration relabels orphaned matching supervisor references',async()=>{
 const {registerEmbeddedRun}=await import('../scripts/run-stats.mjs');
 const {project,runDir}=await fixture();
 try{
  const root=join(project,'.autocode','runs');await mkdir(root,{recursive:true});
  const reference=join(root,`${runId}.json`);
  const original=JSON.stringify({project,runDir,kind:'supervised',note:'retain owner metadata'})+'\n';
  await writeFile(reference,original);
  await registerEmbeddedRun({runDir,runId,cwd:project});
  await registerEmbeddedRun({runDir,runId,cwd:project});
  assert.deepEqual(JSON.parse(await readFile(reference,'utf8')),{project,runDir,kind:'embedded'});
 }finally{await rm(project,{recursive:true,force:true});}
});

test('matching supervised ownership skips embedded owner and registry publication',async()=>{
 const {registerEmbeddedRun}=await import('../scripts/run-stats.mjs');
 const {project,runDir}=await fixture();
 try{
  const control=JSON.stringify({project,runDir,runId,state:'running',childPid:process.pid,token:'controller-owned'});
  await writeFile(join(runDir,'control.json'),control);
  await registerEmbeddedRun({runDir,runId,cwd:project});
  assert.equal(await readFile(join(runDir,'control.json'),'utf8'),control);
  await assert.rejects(readFile(join(runDir,'runner.json')),error=>error.code==='ENOENT');
  await assert.rejects(readFile(join(project,'.autocode','runs',`${runId}.json`)),error=>error.code==='ENOENT');
 }finally{await rm(project,{recursive:true,force:true});}
});

test('conflicting project registration leaves prior runner ownership untouched',async()=>{
 const {registerEmbeddedRun}=await import('../scripts/run-stats.mjs');
 const {project,runDir}=await fixture();
 try{
  const root=join(project,'.autocode','runs');await mkdir(root,{recursive:true});
  await writeFile(join(root,`${runId}.json`),JSON.stringify({project,runDir:join(project,'other')}));
  const original=JSON.stringify({previous:'owner'});
  await writeFile(join(runDir,'runner.json'),original);
  await assert.rejects(registerEmbeddedRun({runDir,runId,cwd:project}),/another run/);
  assert.equal(await readFile(join(runDir,'runner.json'),'utf8'),original);
 }finally{await rm(project,{recursive:true,force:true});}
});

test('unknown or conflicting supervisor records cannot be relabelled as embedded runs',async()=>{
 const {registerEmbeddedRun}=await import('../scripts/run-stats.mjs');
 for(const control of [null,{}, {runId:'wf_22222222-2222-4222-8222-222222222222'}]){
  const {project,runDir}=await fixture();
  try{
   await writeFile(join(runDir,'control.json'),JSON.stringify(control));
   await assert.rejects(registerEmbeddedRun({runDir,runId,cwd:project}),/supervisor ownership/);
   await assert.rejects(readFile(join(runDir,'runner.json')),error=>error.code==='ENOENT');
  }finally{await rm(project,{recursive:true,force:true});}
 }
});

test('read-only projects use a private disk-backed fallback registry',async()=>{
 const {registerEmbeddedRun,projectRunRegistry}=await import('../scripts/run-stats.mjs');
 const {project,runDir}=await fixture();
 const stateRoot=await mkdtemp(join(tmpdir(),'embedded-state-')),previous=process.env.XDG_STATE_HOME;
 process.env.XDG_STATE_HOME=stateRoot;
 try{
  await chmod(project,0o555);
  await registerEmbeddedRun({runDir,runId,cwd:project});
  const reference=join(projectRunRegistry(project),`${runId}.json`);
  assert.deepEqual(JSON.parse(await readFile(reference,'utf8')),{project,runDir,kind:'embedded'});
  assert.ok(reference.startsWith(stateRoot));assert.equal((await stat(reference)).mode&0o777,0o600);
  assert.equal((await readRunStatus(runDir)).state,'running');
 }finally{
  await chmod(project,0o755);
  if(previous===undefined)delete process.env.XDG_STATE_HOME;else process.env.XDG_STATE_HOME=previous;
  await rm(project,{recursive:true,force:true});await rm(stateRoot,{recursive:true,force:true});
 }
});

test('matching supervisor paths may use a symlink alias for the run directory',async()=>{
 const {registerEmbeddedRun}=await import('../scripts/run-stats.mjs');
 const {project,runDir}=await fixture();
 try{
  const alias=join(project,'run-alias');await symlink(runDir,alias);
  await writeFile(join(runDir,'control.json'),JSON.stringify({project,runDir:alias,runId,state:'running',childPid:process.pid}));
  await registerEmbeddedRun({runDir:alias,runId,cwd:project});
  await assert.rejects(readFile(join(runDir,'runner.json')),error=>error.code==='ENOENT');
 }finally{await rm(project,{recursive:true,force:true});}
});

test('embedded resume transfers a completed supervisor run into live embedded ownership',async()=>{
 const {registerEmbeddedRun}=await import('../scripts/run-stats.mjs');
 const {project,runDir}=await fixture();
 try{
  const control={project,runDir,runId,state:'completed',childPid:2147483647,token:'retain privately'};
  await writeFile(join(runDir,'control.json'),JSON.stringify(control));
  const root=join(project,'.autocode','runs');await mkdir(root,{recursive:true});
  await writeFile(join(root,`${runId}.json`),JSON.stringify({project,runDir,kind:'supervised'}));
  await registerEmbeddedRun({runDir,runId,cwd:project});
  const status=await readRunStatus(runDir);
  assert.equal(status.state,'running');assert.equal(status.controllable,false);
  await assert.rejects(readFile(join(runDir,'control.json')),error=>error.code==='ENOENT');
  const {readdir}=await import('node:fs/promises');
  const archived=(await readdir(runDir)).find(name=>/^control\.previous-.*\.json$/.test(name));
  assert.ok(archived);assert.equal((await stat(join(runDir,archived))).mode&0o777,0o600);
  assert.deepEqual(JSON.parse(await readFile(join(runDir,archived),'utf8')),control);
  assert.deepEqual(JSON.parse(await readFile(join(root,`${runId}.json`),'utf8')),{project,runDir,kind:'embedded'});
 }finally{await rm(project,{recursive:true,force:true});}
});

test('completed embedded journals remain terminal while their parent process is alive',async()=>{
 const {registerEmbeddedRun}=await import('../scripts/run-stats.mjs');
 const {project,runDir}=await fixture();
 try{
  await registerEmbeddedRun({runDir,runId,cwd:project});
  await writeFile(join(runDir,'journal.jsonl'),JSON.stringify({type:'run-started',time:1})+'\n'+JSON.stringify({type:'run-finished',time:2,failures:[]})+'\n');
  const status=await readRunStatus(runDir);
  assert.equal(status.state,'completed');assert.equal(status.controllable,false);assert.equal(status.pid,process.pid);
 }finally{await rm(project,{recursive:true,force:true});}
});

test('legacy ownerless runs are unknown and mismatched or dead embedded owners are interrupted',async()=>{
 const {project,runDir}=await fixture();
 try{
  assert.equal((await readRunStatus(runDir)).state,'unknown');
  const proc=await readFile(`/proc/${process.pid}/stat`,'utf8');
  const processStart=proc.slice(proc.lastIndexOf(')')+2).split(' ')[19];
  for(const owner of [{pid:2147483647,processStart:'1',runId},{pid:process.pid,processStart,runId:'different-run'}]){
   await writeFile(join(runDir,'runner.json'),JSON.stringify({project,runDir,...owner}));
   const status=await readRunStatus(runDir);assert.equal(status.state,'interrupted');assert.equal(status.controllable,false);
  }
 }finally{await rm(project,{recursive:true,force:true});}
});

test('another active supervisor cannot be taken over by embedded registration',async()=>{
 const {registerEmbeddedRun}=await import('../scripts/run-stats.mjs');
 const {project,runDir}=await fixture();
 try{
  await writeFile(join(runDir,'control.json'),JSON.stringify({project,runDir,runId,state:'running',childPid:process.ppid}));
  await assert.rejects(registerEmbeddedRun({runDir,runId,cwd:project}),/supervisor ownership/);
  await assert.rejects(readFile(join(runDir,'runner.json')),error=>error.code==='ENOENT');
 }finally{await rm(project,{recursive:true,force:true});}
});

test('dead embedded ownership marks unfinished agent rows interrupted with unknown elapsed time',async()=>{
 const {project,runDir}=await fixture();
 try{
  const now=Date.now();
  await writeFile(join(runDir,'journal.jsonl'),[
   {type:'run-started',time:now-1000},
   {type:'started',key:'agent',label:'unfinished',time:now-900},
   {type:'queued',key:'queued',label:'waiting',time:now-800},
  ].map(event=>JSON.stringify(event)).join('\n')+'\n');
  await writeFile(join(runDir,'runner.json'),JSON.stringify({project,runDir,runId,pid:2147483647,processStart:'1'}));
  const status=await readRunStatus(runDir);
  assert.equal(status.state,'interrupted');
  assert.deepEqual(status.agents.map(agent=>agent.state),['interrupted','interrupted']);
  assert.deepEqual(status.agents.map(agent=>agent.elapsedMs),[null,null]);
  assert.equal(status.elapsedMs,null);
  assert.equal(status.usageIncomplete,true);
 }finally{await rm(project,{recursive:true,force:true});}
});
