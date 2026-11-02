import test from 'node:test';
import fc from 'fast-check';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';
const issue=description=>({file:'src/example.js',line:1,description});
const template=new URL('../assets/templates/exhaustive-review.js',import.meta.url);
test('exhaustive review tells judges to reject uncertain findings',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'template-parity-')),prompts=[];
 try {
  await runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:['src'],maxRounds:1},agent:async prompt=>{
   if(prompt.startsWith('Round'))return {result:{findings:[issue('issue')]},outputTokens:0};
   if(prompt.startsWith('Try')){prompts.push(prompt);return {result:{real:false,reason:'uncertain'},outputTokens:0};}
   return {result:'incomplete',outputTokens:0};
  }});
  assert.equal(prompts.length,3);
  assert.equal(prompts.every(prompt=>prompt.includes('Default to real=false if uncertain')),true);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('a completeness gap becomes another bounded discovery round',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'critic-round-'));let critiques=0;
 try {
  const output=await runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:['src'],maxRounds:6},agent:async prompt=>{
   if(prompt.startsWith('Round'))return {result:{findings:[issue(prompt.includes('parser coverage')?'second issue':'first issue')]},outputTokens:0};
   if(prompt.startsWith('Try'))return {result:{real:true,reason:'reproduced'},outputTokens:0};
   critiques++;return {result:critiques===1?{summary:'missing parser coverage',gaps:['parser coverage']}:{summary:'complete',gaps:[]},outputTokens:0};
  }});
  assert.deepEqual(output.result.confirmed,[issue('first issue'),issue('second issue')]);
  assert.equal(output.result.critique,'complete');
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('a missing completeness verdict remains an explicit unresolved gap',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'missing-critic-'));
 try {
  const output=await runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:['src'],maxRounds:1},agent:async prompt=>({result:prompt.startsWith('Round')?{findings:[]}:null,outputTokens:0})});
  assert.deepEqual(output.result.unresolvedGaps,['Completeness check did not return a validated verdict']);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('invalid discovery round limits are rejected before any agent is started',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'invalid-rounds-'));
 try {
  await assert.rejects(runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:['src'],maxRounds:0},agent:async()=>({result:{summary:'empty',gaps:[]},outputTokens:0})}),/maxRounds/);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('structured findings retain file and line evidence and deduplicate across finder objects',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'structured-review-'));const finding={file:'src/parser.js',line:42,description:'Unchecked length reaches buffer read'};let judgments=0;
 try{
  const output=await runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:['parser','buffers'],maxRounds:3},agent:async(prompt,options)=>{
   if(prompt.startsWith('Round'))return {result:{findings:[structuredClone(finding)]},outputTokens:0};
   if(prompt.startsWith('Try')){judgments++;assert.ok(prompt.includes('src/parser.js')&&prompt.includes('42'),'judge must receive concrete finding evidence');return {result:{real:true,reason:'Confirmed at the cited source line'},outputTokens:0};}
   return {result:{summary:'complete',gaps:[]},outputTokens:0};
  }});
  assert.deepEqual(output.result.confirmed,[finding]);assert.equal(judgments,3);assert.equal(output.result.stoppedAfterDryRounds,true);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

// Source contract: recovered chunk-grs0nvea.js:150-168 (dedup all seen objects,
// diverse judges, two dry rounds); chunk-n7dvjfwp.js:4483-4488 (file/line evidence).
test('repeated structured findings converge independently of object identity',async()=>{
 await fc.assert(fc.asyncProperty(fc.integer({min:1,max:100000}),fc.stringMatching(/^[a-z]{1,20}$/),async(line,description)=>{
  const runDir=await mkdtemp(join(tmpdir(),'review-identity-'));let votes=0;
  const finding={file:'src/input.js',line,description};
  try{
   const output=await runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:['one','two'],maxRounds:5},agent:async prompt=>{
    if(prompt.startsWith('Round'))return {result:{findings:[structuredClone(finding)]},outputTokens:0};
    if(prompt.startsWith('Try')){votes++;return {result:{real:true,reason:'Source evidence verified'},outputTokens:0};}
    return {result:{summary:'complete',gaps:[]},outputTokens:0};
   }});
   assert.deepEqual(output.result.confirmed,[finding]);assert.equal(votes,3);assert.equal(output.result.rounds,3);
  }finally{await rm(runDir,{recursive:true,force:true});}
 }),{seed:20261104,numRuns:20});
});
