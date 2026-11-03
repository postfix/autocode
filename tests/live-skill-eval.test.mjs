import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluateLiveSkill} from '../evals/live-skill.mjs';
async function fixture(){
 await mkdir('.scratch',{recursive:true});const scratch=await mkdtemp('.scratch/skill-eval-test-');const seen={};
 class FakeCodex{startThread(options){seen.parent=options;return {run:async (prompt,options)=>{seen.parentSignal=options?.signal;const file=prompt.match(/workflow in (.*?) using/)[1];await writeFile(file,'export const meta={name:"review",description:"verify"};return parallel([]);');return {finalResponse:'authored',items:seen.skipSkillRead?[]:[{type:'command_execution',command:`cat ${fileURLToPath(new URL('../SKILL.md',import.meta.url))}`,exit_code:0}]};}};}}
 const runCli=async (args,options)=>{seen.cliSignal=options?.signal;seen.args=args;const flag=name=>args[args.indexOf(name)+1];if(args.includes('--context'))seen.context=JSON.parse(await readFile(flag('--context'),'utf8'));const runDir=flag('--run-dir');await mkdir(runDir,{recursive:true});await writeFile(join(runDir,'journal.jsonl'),[1,2,3].flatMap(key=>[{type:'started',key,provider:'codex',model:seen.delegateModel??'gpt-6-luna'},{type:'result',key,result:'verified'}]).map(JSON.stringify).join('\n'));return {code:0,stdout:JSON.stringify({result:seen.result??{findings:[{file:'math.js',symbol:'add',reproduction:{args:[2,3],expected:5,actual:-1}}]},agentCount:3,failures:[],runId:'wf-test'}),stderr:''};};
 return {scratch,seen,FakeCodex,runCli};
}
test('the live skill eval pins Luna for its parent and forces delegated model and effort',async()=>{
 const f=await fixture();try{const report=await evaluateLiveSkill({scratch:f.scratch,CodexClass:f.FakeCodex,runCli:f.runCli});assert.equal(report.passed,true);assert.ok(f.seen.parentSignal instanceof AbortSignal);assert.equal(f.seen.cliSignal,f.seen.parentSignal);assert.equal(f.seen.parent.model,'gpt-6-luna');assert.equal(f.seen.context.providers.codex.forcedModel,'gpt-6-luna');assert.equal(typeof f.seen.context.providers.codex.forcedEffort,'string');}finally{await rm(f.scratch,{recursive:true,force:true});}
});

test('the skill evaluator rejects bug words without a correct executable counterexample',async()=>{
 const f=await fixture();f.seen.result={summary:'subtraction a - b minus defect',findings:[{file:'math.js',symbol:'add',reproduction:{args:[2,3],expected:5,actual:5}}]};
 try{const report=await evaluateLiveSkill({scratch:f.scratch,CodexClass:f.FakeCodex,runCli:f.runCli});assert.equal(report.checks.bugVerified,false);assert.equal(report.passed,false);}finally{await rm(f.scratch,{recursive:true,force:true});}
});

test('the evaluator rejects delegate receipts configured for a different model',async()=>{
 const f=await fixture();f.seen.delegateModel='gpt-6-sol';
 try{const report=await evaluateLiveSkill({scratch:f.scratch,CodexClass:f.FakeCodex,runCli:f.runCli});assert.equal(report.passed,false);assert.equal(report.checks.requiredModelSelection,false);}finally{await rm(f.scratch,{recursive:true,force:true});}
});

test('the authoring smoke deadline aborts the parent and retains its requested model',async()=>{
 const f=await fixture();let release,closed=0,outerTimer;
 class WaitingCodex{startThread(){return {run:async(_prompt,{signal}={})=>new Promise((resolve,reject)=>{release=()=>reject(Error('test cleanup'));signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});}),close:async()=>{closed++;}};}}
 const pending=evaluateLiveSkill({scratch:f.scratch,CodexClass:WaitingCodex,runCli:f.runCli,timeoutMs:10});
 try{const report=await Promise.race([pending,new Promise(resolve=>outerTimer=setTimeout(()=>resolve({outerDeadline:true}),200))]);assert.notEqual(report.outerDeadline,true,'the evaluation must honor its deadline');assert.equal(report.passed,false);assert.match(report.error,/timed out/);assert.equal(report.models.requestedParent,'gpt-6-luna');assert.equal(closed,1);}finally{clearTimeout(outerTimer);release?.();await pending;await rm(f.scratch,{recursive:true,force:true});}
});

test('the authoring smoke deadline also aborts the separate CLI stage',async()=>{
 const f=await fixture();let cliSignal;
 const runCli=async(_args,{signal})=>{cliSignal=signal;return new Promise((resolve,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});};
 try{const report=await evaluateLiveSkill({scratch:f.scratch,CodexClass:f.FakeCodex,runCli,timeoutMs:100});assert.equal(report.passed,false);assert.match(report.error,/timed out/);assert.equal(cliSignal,f.seen.parentSignal);assert.equal(cliSignal.aborted,true);assert.equal(report.models.requestedParent,'gpt-6-luna');}finally{await rm(f.scratch,{recursive:true,force:true});}
});


test('source authoring cannot pass without observing a read of the checkout skill',async()=>{
 const f=await fixture();f.seen.skipSkillRead=true;
 try{const report=await evaluateLiveSkill({scratch:f.scratch,CodexClass:f.FakeCodex,runCli:f.runCli});assert.equal(report.passed,false);assert.equal(report.checks.currentSkillRead,false);}finally{await rm(f.scratch,{recursive:true,force:true});}
});
