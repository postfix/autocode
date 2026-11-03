import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';
import {createReviewContextFixture,snapshotReviewContext,retireReviewContextEvidence,scoreReviewContext,reviewContextToolReceipt,reviewContextCommandReceipt} from '../evals/review-context-fixture.mjs';

async function exercise(reversePolicyKeys=false){
 const root=await mkdtemp(join(tmpdir(),'context-fixture-'));
 const fixture=await createReviewContextFixture(join(root,'project'));
 const calls=[];
 const script=await readFile(new URL('../assets/templates/review-fix-loop.js',import.meta.url),'utf8');
 const result=await runWorkflow({script,args:{packet:fixture.packetPath,reportRoot:fixture.reportsDir,maxRounds:2},runDir:join(root,'run'),cwd:fixture.project,agent:async(prompt,options)=>{
  const before=await snapshotReviewContext(fixture.project),label=options.label;
  let findings=[],summary='Current policy independently checked',verdict=options.phase==='Red Team'?'SOUND':'PASS',changedFiles=[];
  if(label==='R1 Red Team'){
   findings=[{id:'R1-RT-minimum',severity:'MAJOR',title:'Wrong minimum',detail:'The minimum quantity is zero rather than the required one.',fix:'Set minQty to 1.'},{id:'R1-RT-express',severity:'MAJOR',title:'Wrong express fee',detail:'The express shipping fee is zero rather than the required 1299 cents.',fix:'Set expressCents to 1299.'}];
   verdict='NEEDS_REVISION';summary='Stored initial evidence in the report';
  }
  if(options.phase.startsWith('Fix')){await writeFile(fixture.policyPath,JSON.stringify(reversePolicyKeys?{expressCents:1299,minQty:1}:{minQty:1,expressCents:1299})+'\n');verdict='FIXED';changedFiles=['policy.json'];}
  const reportPath=join(fixture.reportsDir,({'R1 Red Team':'round-1-red-team.md','R1 Fix Red Team':'round-1-red-team-fixes.md','R1 QA':'round-1-qa.md','R2 Red Team':'round-2-red-team.md','R2 QA':'round-2-qa.md'})[label]);
  let report='Independent policy report';const toolReceipts=[];
  if(label==='R1 Red Team')report+='\n'+await readFile(fixture.evidencePath,'utf8');
  if(label==='R2 Red Team'){
   const original=await readFile(join(fixture.reportsDir,'round-1-red-team.md'),'utf8');
   toolReceipts.push(reviewContextToolReceipt(fixture,{tool:'Read',id:'fixture-read',input:{file_path:join(fixture.reportsDir,'round-1-red-team.md')},output:original,source:'Deterministic mock tool result'}));
   const nonce=/EVIDENCE_NONCE=([^\s]+)/.exec(original)[1];summary=`Recovered nonce from the referenced report: ${nonce}`;
  }
  await writeFile(reportPath,report+'\n');
  const after=await snapshotReviewContext(fixture.project);
  const response={verdict,subjectHash:after['policy.json'],reportPath,summary,findings,unresolvedIds:[],changedFiles,limitations:[]};
  calls.push({label,phase:options.phase,prompt,result:response,before,after,toolReceipts});
  if(label==='R1 Red Team')await retireReviewContextEvidence(fixture,response);
  return {result:response,outputTokens:1};
 }});
 return {root,fixture,calls,result};
}

test('matched context fixture proves report retrieval, real file repair and verified closure through the public template',async()=>{
 const run=await exercise();
 try{
  const score=await scoreReviewContext(run);
  assert.equal(score.passed,true,JSON.stringify(score));
  assert.equal(run.calls.length,5);
 }finally{await rm(run.root,{recursive:true,force:true});}
});


test('policy correctness is independent of JSON object key order',async()=>{
 await fc.assert(fc.asyncProperty(fc.boolean(),async reverse=>{
  const run=await exercise(reverse);
  try{assert.equal((await scoreReviewContext(run)).passed,true);}finally{await rm(run.root,{recursive:true,force:true});}
 }),{seed:20261103,numRuns:8});
});

test('oracle rejects evidence that remained available to later delegates',async()=>{
 const run=await exercise();
 try{
  for(const call of run.calls.slice(1)){call.before['evidence.txt']=run.fixture.initialHashes['evidence.txt'];call.after['evidence.txt']=run.fixture.initialHashes['evidence.txt'];}
  assert.equal((await scoreReviewContext(run)).passed,false);
 }finally{await rm(run.root,{recursive:true,force:true});}
});

test('oracle records incomplete provider attempts without throwing away their evidence',async()=>{
 const run=await exercise();
 try{
  const score=await scoreReviewContext({...run,calls:[],result:undefined});
  assert.equal(score.passed,false);
 }finally{await rm(run.root,{recursive:true,force:true});}
});

test('oracle rejects leaked context across arbitrary prompt or result placement',async()=>{
 await fc.assert(fc.asyncProperty(fc.constantFrom('prompt','parent','first-result'),fc.string({maxLength:12}),async(where,prefix)=>{
  const run=await exercise();
  try{
   if(where==='prompt')run.calls[3].prompt+=prefix+run.fixture.nonce;
   if(where==='parent')run.result.result.leak=prefix+run.fixture.nonce;
   if(where==='first-result')run.calls[0].result.summary+=prefix+run.fixture.nonce;
   assert.equal((await scoreReviewContext(run)).passed,false);
  }finally{await rm(run.root,{recursive:true,force:true});}
 }),{seed:20261103,numRuns:9});
});

test('oracle rejects missing retrieval or repair, wrong hashes, false clean claims, historical bodies and extra edits',async()=>{
 for(const sabotage of ['retrieval','repair','hash','false-clean','history','extra-edit']){
  const run=await exercise();
  try{
   if(sabotage==='retrieval')run.calls[3].result.summary='Did not retrieve prior evidence';
   if(sabotage==='repair')await writeFile(run.fixture.policyPath,'{"minQty":0,"expressCents":0}\n');
   if(sabotage==='hash')run.calls[2].result.subjectHash='wrong';
   if(sabotage==='false-clean')run.calls[4].result.verdict='NEEDS_REVISION';
   if(sabotage==='history')run.calls[3].prompt+='\nPrevious result: '+JSON.stringify(run.calls[0].result);
   if(sabotage==='extra-edit')await writeFile(join(run.fixture.project,'unexpected.txt'),'unauthorized fixture change');
   assert.equal((await scoreReviewContext(run)).passed,false,sabotage);
  }finally{await rm(run.root,{recursive:true,force:true});}
 }
});

test('a model-only nonce claim without a successful original-report tool read is not retrieval proof',async()=>{
 const run=await exercise();
 try{
  run.calls[3].toolReceipts=[];
  assert.equal((await scoreReviewContext(run)).passed,false);
 }finally{await rm(run.root,{recursive:true,force:true});}
});


test('receipt oracle rejects wrong files, failed reads, missing nonce and inline nonce echoes',async()=>{
 const run=await exercise();
 try{
  const report=join(run.fixture.reportsDir,'round-1-red-team.md'),nonce=run.fixture.nonce;
  const bad=[
   reviewContextToolReceipt(run.fixture,{tool:'Read',id:'outside',input:{file_path:join(run.root,'fixture-oracle.json')},output:nonce}),
   reviewContextToolReceipt(run.fixture,{tool:'Read',id:'failed',input:{file_path:report},output:nonce,isError:true}),
   reviewContextToolReceipt(run.fixture,{tool:'Grep',id:'missing',input:{path:report},output:'No matching evidence'}),
   reviewContextCommandReceipt(run.fixture,{id:'echo',command:`echo ${nonce}; cat ${report}`,output:nonce,exitCode:0}),
   reviewContextCommandReceipt(run.fixture,{id:'exit',command:`cat ${report}`,output:nonce,exitCode:1}),
  ];
  for(const receipt of bad){run.calls[3].toolReceipts=[receipt];assert.equal((await scoreReviewContext(run)).passed,false,receipt.id);}
  const receipt=reviewContextToolReceipt(run.fixture,{tool:'Grep',id:'valid',input:{path:report,pattern:'EVIDENCE_NONCE'},output:`PRIVATE_REPORT_BODY ${nonce}`});
  assert.ok(!JSON.stringify(receipt).includes('PRIVATE_REPORT_BODY'));
  assert.ok(!JSON.stringify(receipt).includes(nonce));
  run.calls[3].toolReceipts=[receipt];assert.equal((await scoreReviewContext(run)).passed,true);
 }finally{await rm(run.root,{recursive:true,force:true});}
});
