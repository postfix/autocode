import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createFullTaskFixture,scoreFullTask} from '../evals/full-task-fixture.mjs';

const findings=[
 {file:'src/quantity.mjs',line:1,symbol:'validateQuantity',title:'Zero quantity is accepted',evidence:'validateQuantity(0) returns true although quantities must start at 1.',reproduction:{args:[0],expected:false,actual:true}},
 {file:'src/pricing.mjs',line:1,symbol:'discountedSubtotal',title:'Threshold member discount missing',evidence:'At 10000 cents a member receives no 10% discount.',reproduction:{args:[10000,true],expected:9000,actual:10000}},
 {file:'src/shipping.mjs',line:1,symbol:'shippingCost',title:'Express shipping becomes free',evidence:'shippingCost(5000,true) returns 0 instead of 1299.',reproduction:{args:[5000,true],expected:1299,actual:0}},
 {file:'src/refunds.mjs',line:1,symbol:'refundAmount',title:'Partial refunds round upward',evidence:'refundAmount(10000,3,1) returns 3334 rather than flooring to 3333.',reproduction:{args:[10000,3,1],expected:3333,actual:3334}},
];
const journal=[
 {type:'started',key:'r1',label:'reviewer-1'},{type:'started',key:'r2',label:'reviewer-2'},
 {type:'agent-finished',key:'r1'},{type:'agent-finished',key:'r2'},
 {type:'started',key:'v',label:'skeptical-verifier'},{type:'result',key:'v',result:{findings}},{type:'agent-finished',key:'v'},
];
test('full task oracle verifies real defects, parallel review and unchanged fixture sources',async()=>{
 const project=await mkdtemp(join(tmpdir(),'full-task-fixture-'));
 try{
  const {sourceHashes}=await createFullTaskFixture(project);
  const score=await scoreFullTask({project,sourceHashes,report:{findings},workflowResult:{findings},journal});
  assert.equal(score.passed,true);
  assert.equal(score.matchedFindings.length,4);
  assert.equal(score.delegation.parallelReviewers,true);
  assert.equal(score.sourceUnchanged,true);
  assert.ok((await readFile(join(project,'README.md'),'utf8')).includes('All monetary amounts are integer cents'));
 }finally{await rm(project,{recursive:true,force:true});}
});

test('a parent report cannot replace missing workflow and skeptical verifier findings',async()=>{
 const project=await mkdtemp(join(tmpdir(),'full-task-detached-report-'));
 try{
  const {sourceHashes}=await createFullTaskFixture(project);
  const score=await scoreFullTask({project,sourceHashes,report:{findings},workflowResult:{findings:[]},journal:journal.map(event=>event.type==='result'?{...event,result:{findings:[]}}:event)});
  assert.equal(score.passed,false);
 }finally{await rm(project,{recursive:true,force:true});}
});

test('full task oracle rejects wrong counterexamples even at the correct defect locations',async()=>{
 const project=await mkdtemp(join(tmpdir(),'full-task-wrong-proof-'));
 try{
  const {sourceHashes}=await createFullTaskFixture(project);
  const wrong=structuredClone(findings);wrong[0].reproduction={args:[1],expected:false,actual:true};
  const events=journal.map(event=>event.type==='result'?{...event,result:{findings:wrong}}:event);
  const score=await scoreFullTask({project,sourceHashes,report:{findings:wrong},workflowResult:{findings:wrong},journal:events});
  assert.equal(score.passed,false);assert.equal(score.falsePositives.length,1);assert.equal(score.missingFindings[0].category,'quantity');
 }finally{await rm(project,{recursive:true,force:true});}
});

test('full task oracle rejects correct decoys, edited sources and serialized reviewer calls',async()=>{
 const project=await mkdtemp(join(tmpdir(),'full-task-boundaries-'));
 try{
  const {sourceHashes}=await createFullTaskFixture(project);
  const extra=[...findings,{file:'src/tax.mjs',line:1,symbol:'taxCents',title:'Half cents round up',evidence:'Claims intentional rounding is incorrect',reproduction:{args:[1,5000],expected:0,actual:1}}];
  const decoyScore=await scoreFullTask({project,sourceHashes,report:{findings:extra},workflowResult:{findings:extra},journal});
  assert.equal(decoyScore.passed,false);assert.equal(decoyScore.decoyFindings.length,1);
  const serial=[journal[0],journal[2],journal[1],journal[3],...journal.slice(4)];
  const serialScore=await scoreFullTask({project,sourceHashes,report:{findings},workflowResult:{findings},journal:serial});
  assert.equal(serialScore.passed,false);assert.equal(serialScore.delegation.parallelReviewers,false);
  await writeFile(join(project,'src/quantity.mjs'),'throw Error("Modified source must not execute");\n');
  const changed=await scoreFullTask({project,sourceHashes,report:{findings},workflowResult:{findings},journal});
  assert.equal(changed.passed,false);assert.deepEqual(changed.sourceChanges,['src/quantity.mjs']);assert.equal(changed.oracle.defectsConfirmed,false);
 }finally{await rm(project,{recursive:true,force:true});}
});

test('equivalent structured reports do not depend on JSON object key order',async()=>{
 const {default:fc}=await import('fast-check');
 const project=await mkdtemp(join(tmpdir(),'full-task-key-order-'));
 try{
  const {sourceHashes}=await createFullTaskFixture(project);
  await fc.assert(fc.asyncProperty(fc.shuffledSubarray(['file','line','symbol','title','evidence','reproduction'],{minLength:6,maxLength:6}),async keys=>{
   const report={findings:findings.map(value=>Object.fromEntries(keys.map(key=>[key,value[key]])))};
   assert.equal((await scoreFullTask({project,sourceHashes,report,workflowResult:{findings},journal})).passed,true);
  }),{seed:2601102,numRuns:20});
 }finally{await rm(project,{recursive:true,force:true});}
});
