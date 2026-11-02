import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {runWorkflow} from '../scripts/runtime.mjs';
test('a worktree agent can edit without changing the main working copy',async()=>{
 const root=await mkdtemp(join(tmpdir(),'worktree-parity-'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try {
  git('init');await writeFile(join(root,'value.txt'),'original');git('add','value.txt');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture');
  const output=await runWorkflow({cwd:root,runDir:join(root,'runs'),script:'export const meta={name:"isolate",description:"isolate"};return agent("edit",{isolation:"worktree"});',
    agent:async(_p,_o,context)=>{await writeFile(join(context.cwd??root,'value.txt'),'edited');return {result:'done',outputTokens:1};}});
  assert.equal(await readFile(join(root,'value.txt'),'utf8'),'original');
  assert.equal(await readFile(join(output.worktrees[0].path,'value.txt'),'utf8'),'edited');
  const resumed=await runWorkflow({cwd:root,runDir:join(root,'runs'),resumeFromRunId:output.runId,script:'export const meta={name:"isolate",description:"isolate"};return agent("edit",{isolation:"worktree"});',agent:async()=>{throw Error('completed edit must be cached');}});
  assert.deepEqual(resumed.worktrees,output.worktrees);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('worktree setup failures preserve the original actionable Git error',async()=>{
 const root=await mkdtemp(join(tmpdir(),'worktree-error-'));
 const previousCeiling=process.env.GIT_CEILING_DIRECTORIES;
 process.env.GIT_CEILING_DIRECTORIES=join(root,'..');
 try {
  await assert.rejects(runWorkflow({cwd:root,runDir:join(root,'runs'),script:'export const meta={name:"isolate",description:"isolate"};return agent("edit",{isolation:"worktree"});',agent:async()=>({result:'unexpected',outputTokens:0})}),/not a git repository/);
 }finally{
  if(previousCeiling===undefined)delete process.env.GIT_CEILING_DIRECTORIES;else process.env.GIT_CEILING_DIRECTORIES=previousCeiling;
  await rm(root,{recursive:true,force:true});
 }
});

test('ignored files created by an agent are retained rather than deleted during cleanup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ignored-worktree-'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try {
  git('init');await writeFile(join(root,'.gitignore'),'build.txt\n');git('add','.gitignore');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture');
  const output=await runWorkflow({cwd:root,runDir:join(root,'runs'),script:'export const meta={name:"build",description:"build"};return agent("build",{isolation:"worktree"});',agent:async(_p,_o,context)=>{await writeFile(join(context.cwd,'build.txt'),'artifact');return {result:'built',outputTokens:0};}});
  assert.equal(output.worktrees.length,1);
  assert.equal(await readFile(join(output.worktrees[0].path,'build.txt'),'utf8'),'artifact');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('committed agent changes are retained even when the worktree is clean',async()=>{
 const root=await mkdtemp(join(tmpdir(),'committed-worktree-'));
 const git=(cwd,...args)=>execFileSync('git',args,{cwd,stdio:'pipe'});
 try {
  git(root,'init');await writeFile(join(root,'value.txt'),'original');git(root,'add','value.txt');git(root,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture');
  const output=await runWorkflow({cwd:root,runDir:join(root,'runs'),script:'export const meta={name:"commit",description:"commit"};return agent("commit",{isolation:"worktree"});',agent:async(_p,_o,context)=>{await writeFile(join(context.cwd,'value.txt'),'committed');git(context.cwd,'add','value.txt');git(context.cwd,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','agent change');return {result:'committed',outputTokens:0};}});
  assert.equal(output.worktrees.length,1);
  assert.equal(await readFile(join(output.worktrees[0].path,'value.txt'),'utf8'),'committed');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('unacknowledged cancellation preserves the worktree even when it still looks clean',async()=>{
 const root=await mkdtemp(join(tmpdir(),'unconfirmed-worktree-'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 try {
  git('init');await writeFile(join(root,'value.txt'),'original');git('add','value.txt');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture');
  await assert.rejects(runWorkflow({cwd:root,runDir:join(root,'runs'),script:'export const meta={name:"stalled",description:"stalled"};return agent("wait",{isolation:"worktree",stallMs:5});',agent:async()=>new Promise(()=>{})}),/without acknowledging cancellation/);
  assert.equal((await readdir(join(root,'runs','worktrees'))).length,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
