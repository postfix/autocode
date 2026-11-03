import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';

const finding={id:'R1-RT-1',severity:'MAJOR',title:'Missing transition',detail:'OLD_VERIFIED_FINDING_DETAIL',fix:'Define the missing transition'};
function result(label,overrides={}){return {verdict:'PASS',subjectHash:'h1',reportPath:`reports/${label}.md`,summary:`VERBOSE_BODY_${label}`,findings:[],unresolvedIds:[],changedFiles:[],limitations:[],...overrides};}
async function run(responses){
 const source=await readFile(process.env.REVIEW_LOOP_TEMPLATE??new URL('../assets/templates/review-fix-loop.js',import.meta.url),'utf8');
 const runDir=await mkdtemp(join(tmpdir(),'review-context-')),prompts=new Map();
 try{
  const output=await runWorkflow({script:source,runDir,args:{packet:'packet.md',reportRoot:'reports/',maxRounds:2},agent:async(prompt,opts)=>{
   prompts.set(opts.label,prompt);assert.ok(responses[opts.label],`unexpected stage ${opts.label}`);
   return {result:responses[opts.label],outputTokens:1};
  }});
  return {output,prompts};
 }finally{await rm(runDir,{recursive:true,force:true});}
}
test('review loop passes current findings and report references instead of accumulated result bodies',async()=>{
 const {output,prompts}=await run({
  'R1 Red Team':result('r1-rt',{verdict:'NEEDS_REVISION',subjectHash:'h0',findings:[finding]}),
  'R1 Fix Red Team':result('r1-fix',{verdict:'FIXED',changedFiles:['design.md']}),
  'R1 QA':result('r1-qa'),
  'R2 Red Team':result('r2-rt',{verdict:'SOUND'}),
  'R2 QA':result('r2-qa'),
 });
 const next=prompts.get('R2 Red Team');
 assert.doesNotMatch(next,/OLD_VERIFIED_FINDING_DETAIL|VERBOSE_BODY_/,'a new round must not reload closed findings or prior full results');
 assert.match(next,/reports\/r1-qa.md/,'closed evidence must remain retrievable by reference');
 assert.doesNotMatch(prompts.get('R1 QA'),/VERBOSE_BODY_r1-fix/,'QA needs the fix reference, not its narrative body');
 assert.match(prompts.get('R1 Fix Red Team'),/OLD_VERIFIED_FINDING_DETAIL/,'the fixer must retain the actionable current finding');
 assert.equal(output.result.status,'clean');assert.equal(output.result.rounds,2);
 assert.equal(Object.hasOwn(output.result,'history'),false,'the parent must not receive every historical result body');
 assert.deepEqual(output.result.openFindings,[]);
});

test('fix claims stay pending until independent same-subject QA verifies closure',async()=>{
 const {output,prompts}=await run({
  'R1 Red Team':result('r1-rt',{verdict:'NEEDS_REVISION',subjectHash:'h0',findings:[finding]}),
  'R1 Fix Red Team':result('r1-fix',{verdict:'FIXED',changedFiles:['design.md']}),
  'R1 QA':result('r1-qa',{verdict:'NEEDS_REVISION',unresolvedIds:[finding.id]}),
  'R1 Fix QA':result('r1-qa-fix',{verdict:'FIXED',changedFiles:['design.md']}),
  'R2 Red Team':result('r2-rt',{verdict:'SOUND'}),
  'R2 QA':result('r2-qa'),
 });
 const next=JSON.parse(prompts.get('R2 Red Team').split('Previous stage data: ')[1]);
 assert.equal(next.openFindings.length,1);assert.equal(next.openFindings[0].id,finding.id);
 assert.equal(next.openFindings[0].state,'pending_verification');
 assert.equal(next.openFindings[0].sourceReport,'reports/r1-rt.md');
 assert.equal(Object.hasOwn(next.openFindings[0],'detail'),false,'later reviewers receive an open-finding index, not full prior proof bodies');
 assert.equal(Object.hasOwn(next.openFindings[0],'fix'),false);
 assert.equal(next.latestChange.reportPath,'reports/r1-qa-fix.md');
 assert.deepEqual(output.result.openFindings,[]);
});

test('QA on a different subject hash cannot erase pending findings or declare the loop clean',async()=>{
 const {output}=await run({
  'R1 Red Team':result('r1-rt',{verdict:'NEEDS_REVISION',subjectHash:'h0',findings:[finding]}),
  'R1 Fix Red Team':result('r1-fix',{verdict:'FIXED'}),
  'R1 QA':result('r1-qa',{subjectHash:'different'}),
  'R2 Red Team':result('r2-rt',{verdict:'SOUND'}),
  'R2 QA':result('r2-qa',{subjectHash:'different'}),
  'R3 Red Team':result('r3-rt',{verdict:'SOUND'}),
  'R3 QA':result('r3-qa',{subjectHash:'different'}),
 });
 assert.equal(output.result.status,'round_limit');
 assert.equal(output.result.openFindings.length,1);assert.equal(output.result.openFindings[0].id,finding.id);
});


test('verified closed result bodies never leak into later review prompts or the parent result',async()=>{
 await fc.assert(fc.asyncProperty(fc.uuid(),async marker=>{
  const {output,prompts}=await run({
   'R1 Red Team':result('r1-rt',{verdict:'NEEDS_REVISION',subjectHash:'h0',summary:`CLOSED_RESULT_${marker}`,findings:[{...finding,detail:`CLOSED_DETAIL_${marker}`}]}),
   'R1 Fix Red Team':result('r1-fix',{verdict:'FIXED'}),
   'R1 QA':result('r1-qa'),
   'R2 Red Team':result('r2-rt',{verdict:'SOUND'}),
   'R2 QA':result('r2-qa'),
  });
  assert.equal(prompts.get('R2 Red Team').includes(marker),false);
  assert.equal(JSON.stringify(output.result).includes(marker),false);
 }),{seed:20261103,numRuns:12});
});

test('agreement on an old hash cannot close findings after a newer QA fix',async()=>{
 const {output}=await run({
  'R1 Red Team':result('r1-rt',{verdict:'NEEDS_REVISION',subjectHash:'h0',findings:[finding]}),
  'R1 Fix Red Team':result('r1-fix',{verdict:'FIXED',subjectHash:'h1'}),
  'R1 QA':result('r1-qa',{verdict:'NEEDS_REVISION',subjectHash:'h1',unresolvedIds:[finding.id]}),
  'R1 Fix QA':result('r1-qa-fix',{verdict:'FIXED',subjectHash:'h2'}),
  'R2 Red Team':result('r2-rt',{verdict:'SOUND',subjectHash:'h1'}),
  'R2 QA':result('r2-qa',{subjectHash:'h1'}),
  'R3 Red Team':result('r3-rt',{verdict:'SOUND',subjectHash:'h1'}),
  'R3 QA':result('r3-qa',{subjectHash:'h1'}),
 });
 assert.equal(output.result.status,'round_limit','matching stale reviewers must not override the latest changed subject');
 assert.equal(output.result.openFindings[0].id,finding.id);
});

test('blank subject or report references cannot establish review completion',async()=>{
 await fc.assert(fc.asyncProperty(fc.constantFrom('subjectHash','reportPath'),fc.constantFrom('',' ','\n'),async(field,value)=>{
  await assert.rejects(run({
   'R1 Red Team':result('r1-rt',{verdict:'SOUND',[field]:value}),
   'R1 QA':result('r1-qa',{[field]:value}),
  }),/nonblank subjectHash and reportPath/);
 }),{seed:20261103,numRuns:12});
});

test('a reopened finding uses current evidence without restoring its closed proof body',async()=>{
 const {prompts}=await run({
  'R1 Red Team':result('r1-rt',{verdict:'NEEDS_REVISION',subjectHash:'h0',findings:[finding]}),
  'R1 Fix Red Team':result('r1-fix',{verdict:'FIXED'}),
  'R1 QA':result('r1-qa'),
  'R2 Red Team':result('r2-rt',{verdict:'NEEDS_REVISION',findings:[{...finding,detail:'NEW_CURRENT_EVIDENCE'}]}),
  'R2 Fix Red Team':result('r2-fix',{verdict:'FIXED',subjectHash:'h2'}),
  'R2 QA':result('r2-qa',{subjectHash:'h2'}),
  'R3 Red Team':result('r3-rt',{verdict:'SOUND',subjectHash:'h2'}),
  'R3 QA':result('r3-qa',{subjectHash:'h2'}),
 });
 const fixed=JSON.parse(prompts.get('R2 Fix Red Team').split('Previous stage data: ')[1]);
 assert.equal(fixed.findings.length,1);assert.equal(fixed.findings[0].id,finding.id);
 assert.equal(fixed.findings[0].detail,'NEW_CURRENT_EVIDENCE');
 assert.doesNotMatch(prompts.get('R2 Fix Red Team'),/OLD_VERIFIED_FINDING_DETAIL/);
});

test('pending findings survive UNKNOWN or omitted IDs until independent verification',async()=>{
 await fc.assert(fc.asyncProperty(fc.uuid(),fc.constantFrom('UNKNOWN','NEEDS_REVISION'),fc.boolean(),async(id,verdict,omitIds)=>{
  const unresolvedIds=omitIds?[]:[id],nextHash=omitIds?'h1':'h2';
  const responses={
   'R1 Red Team':result('r1-rt',{verdict:'NEEDS_REVISION',subjectHash:'h0',findings:[{...finding,id}]}),
   'R1 Fix Red Team':result('r1-fix',{verdict:'FIXED'}),
   'R1 QA':result('r1-qa',{verdict,unresolvedIds}),
   'R1 Fix QA':result('r1-qa-fix',{verdict:'FIXED',subjectHash:'h2'}),
   'R2 Red Team':result('r2-rt',{verdict:'SOUND',subjectHash:nextHash}),
   'R2 QA':result('r2-qa',{verdict:'UNKNOWN',subjectHash:nextHash}),
   'R3 Red Team':result('r3-rt',{verdict:'SOUND',subjectHash:nextHash}),
   'R3 QA':result('r3-qa',{verdict:'UNKNOWN',subjectHash:nextHash}),
  };
  const {output,prompts}=await run(responses);
  const next=JSON.parse(prompts.get('R2 Red Team').split('Previous stage data: ')[1]);
  assert.equal(next.openFindings.length,1);assert.equal(next.openFindings[0].id,id);
  assert.equal(output.result.status,'round_limit');assert.equal(output.result.openFindings[0].id,id);
 }),{seed:20261103,numRuns:16});
});
