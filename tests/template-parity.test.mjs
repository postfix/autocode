import test from 'node:test';
import fc from 'fast-check';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';
const issue=description=>({id:description.replaceAll(' ','-'),file:'src/example.js',line:1,description});
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
   if(prompt.startsWith('Round')){const second=prompt.includes('parser coverage');return {result:{findings:[{...issue(second?'second issue':'first issue'),line:second?2:1}]},outputTokens:0};}
   if(prompt.startsWith('Try'))return {result:{real:true,reason:'reproduced'},outputTokens:0};
   critiques++;return {result:critiques===1?{summary:'missing parser coverage',gaps:['parser coverage']}:{summary:'complete',gaps:[]},outputTokens:0};
  }});
  assert.deepEqual(output.result.confirmed,[issue('first issue'),{...issue('second issue'),line:2}]);
  assert.equal(output.result.critique,'complete');
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('a missing completeness verdict remains an explicit unresolved gap',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'missing-critic-'));
 try {
  const output=await runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:['src'],maxRounds:1},agent:async prompt=>({result:prompt.startsWith('Round')?{findings:[]}:null,outputTokens:0})});
  assert.deepEqual(output.result.unresolvedGaps,['Completeness check did not return a validated verdict','Review stopped at maxRounds=1 before convergence']);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('invalid discovery round limits are rejected before any agent is started',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'invalid-rounds-'));
 try {
  await assert.rejects(runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:['src'],maxRounds:0},agent:async()=>({result:{summary:'empty',gaps:[]},outputTokens:0})}),/maxRounds/);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('structured findings retain file and line evidence and deduplicate across finder objects',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'structured-review-'));const finding={id:'unchecked-length',file:'src/parser.js',line:42,description:'Unchecked length reaches buffer read'};let judgments=0;
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
  const finding={id:'input-boundary',file:'src/input.js',line,description};
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

test('a failed discovery topic remains unresolved rather than counting as a dry round',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'failed-discovery-'));let criticPrompt;
 try{
  const output=await runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:['parser','billing'],maxRounds:3},agent:async prompt=>{
   if(prompt.startsWith('Round')){
    if(prompt.includes('issues in billing.'))throw Object.assign(Error('billing finder unavailable'),{kind:'terminal-api'});
    return {result:{findings:[]},outputTokens:0};
   }
   criticPrompt=prompt;return {result:{summary:'No additional gaps',gaps:[]},outputTokens:0};
  }});
  assert.equal(output.result.stoppedAfterDryRounds,false,'a failed finder supplies no evidence that discovery was dry');
  assert.equal(output.result.rounds,3);
  assert.deepEqual(output.result.unresolvedGaps,['Discovery did not return a validated result for topic: billing','Review stopped at maxRounds=3 before convergence']);
  assert.ok(criticPrompt.includes('"failedTopics":["billing"]'),'critic must receive the actual failed topic');
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('successful rediscovery closes an earlier failed topic coverage gap',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'recovered-discovery-'));let rounds=0,criticPrompt;
 try{
  const output=await runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:['billing'],maxRounds:4},agent:async prompt=>{
   if(prompt.startsWith('Round')){if(++rounds===1)throw Object.assign(Error('temporary finder failure'),{kind:'terminal-api'});return {result:{findings:[]},outputTokens:0};}
   criticPrompt=prompt;return {result:{summary:'Coverage restored',gaps:[]},outputTokens:0};
  }});
  assert.equal(output.result.rounds,3);assert.equal(output.result.stoppedAfterDryRounds,true);
  assert.deepEqual(output.result.unresolvedGaps,[]);assert.ok(criticPrompt.includes('"failedTopics":[]'));
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('paraphrases of one stable issue converge while distinct issues on one line remain',async()=>{
 await fc.assert(fc.asyncProperty(fc.integer({min:1,max:100000}),fc.stringMatching(/^[a-z]{1,10}$/),async(line,description)=>{
  const runDir=await mkdtemp(join(tmpdir(),'review-paraphrases-'));let votes=0,secondRoundPrompt;
  try{
   const output=await runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:['one','two'],maxRounds:5},agent:async prompt=>{
    if(prompt.startsWith('Round')){
     const round=Number(/^Round (\d+)/.exec(prompt)[1]);if(round===2)secondRoundPrompt=prompt;
     return {result:{findings:[{id:'boundary-check',file:'src/input.js',line,description:`${description} wording ${round} ${prompt.includes('issues in one.')?'one':'two'}`},{id:'different-invariant',file:'src/input.js',line,description:'A different issue at the same source position'}]},outputTokens:0};
    }
    if(prompt.startsWith('Try')){votes++;return {result:{real:true,reason:'Verified at the cited position'},outputTokens:0};}
    return {result:{summary:'Complete',gaps:[]},outputTokens:0};
   }});
   assert.equal(output.result.confirmed.length,2,'distinct issue IDs on one line must not collapse');
   assert.deepEqual(output.result.confirmed.map(finding=>finding.id),['boundary-check','different-invariant']);
   assert.ok(secondRoundPrompt.includes('Already seen issue identities and claims:')&&secondRoundPrompt.includes('boundary-check')&&secondRoundPrompt.includes('different-invariant'),'finders need prior stable identities, not just a round number');
   assert.equal(votes,6);assert.equal(output.result.rounds,3);assert.equal(output.result.stoppedAfterDryRounds,true);
  }finally{await rm(runDir,{recursive:true,force:true});}
 }),{seed:20261103,numRuns:10});
});

test('default exhaustive discovery continues past four productive rounds until two dry rounds',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'no-default-round-cap-'));let rounds=0;
 try{
  const output=await runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:['src']},agent:async prompt=>{
   if(prompt.startsWith('Round')){rounds++;return {result:{findings:rounds<=5?[{id:`invariant-${rounds}`,file:'src/a.js',line:rounds,description:`Issue ${rounds}`}]:[]},outputTokens:0};}
   if(prompt.startsWith('Try'))return {result:{real:true,reason:'Confirmed'},outputTokens:0};
   return {result:{summary:'Complete',gaps:[]},outputTokens:0};
  }});
  assert.equal(output.result.rounds,7,'default discovery must not stop at an arbitrary four-round cap');
  assert.equal(output.result.confirmed.length,5);assert.equal(output.result.status,'complete');assert.equal(output.result.stopReason,'dryRounds');
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('missing verification verdicts remain unresolved even when the critic reports no gaps',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'missing-panel-verdicts-'));let criticPrompt;
 try{
  const output=await runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:['src'],maxRounds:3},agent:async prompt=>{
   if(prompt.startsWith('Round'))return {result:{findings:[issue('claim')]},outputTokens:0};
   if(prompt.startsWith('Try'))return {result:null,outputTokens:0};
   criticPrompt=prompt;return {result:{summary:'No gaps',gaps:[]},outputTokens:0};
  }});
  assert.equal(output.result.status,'incomplete','missing votes must not become a completed exhaustive review');
  assert.equal(output.result.confirmed.length,0);
  assert.ok(output.result.unresolvedGaps.some(gap=>gap.includes('Verification incomplete')&&gap.includes('claim')));
  assert.ok(criticPrompt.includes('"unverified":')&&criticPrompt.includes('claim'),'critic must see the unverified candidate rather than only confirmed findings');
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('a recovered missing lens completes its panel without repeating successful votes',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'recovered-panel-')),calls={correctness:0,security:0,reproducibility:0};
 try{
  const output=await runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:['src']},agent:async prompt=>{
   if(prompt.startsWith('Round'))return {result:{findings:[issue('claim')]},outputTokens:0};
   if(prompt.startsWith('Try')){const lens=Object.keys(calls).find(lens=>prompt.includes(`through ${lens}:`));calls[lens]++;return {result:lens==='security'&&calls[lens]===1?null:{real:true,reason:'Confirmed'},outputTokens:0};}
   return {result:{summary:'Coverage restored',gaps:[]},outputTokens:0};
  }});
  assert.deepEqual(calls,{correctness:1,security:2,reproducibility:1});
  assert.equal(output.result.status,'complete');assert.deepEqual(output.result.confirmed,[issue('claim')]);assert.deepEqual(output.result.unverified,[]);assert.deepEqual(output.result.unresolvedGaps,[]);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('the critic distinguishes rejected claims from unverified claims',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'rejected-panel-'));let criticPrompt;
 try{
  const output=await runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:['src']},agent:async prompt=>{
   if(prompt.startsWith('Round'))return {result:{findings:[issue('refuted claim')]},outputTokens:0};
   if(prompt.startsWith('Try'))return {result:{real:false,reason:'Counterexample refutes the claim'},outputTokens:0};
   criticPrompt=prompt;return {result:{summary:'Complete',gaps:[]},outputTokens:0};
  }});
  assert.equal(output.result.status,'complete');assert.equal(output.result.rejected.length,1);assert.deepEqual(output.result.unverified,[]);
  assert.ok(criticPrompt.includes('"rejected":[{"finding":')&&criticPrompt.includes('"unverified":[]'));
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('an explicit round cap returns machine-readable incomplete coverage',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'explicit-cap-'));
 try{
  const output=await runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:['src'],maxRounds:1},agent:async prompt=>({result:prompt.startsWith('Round')?{findings:[issue('claim')]}:prompt.startsWith('Try')?{real:true,reason:'Confirmed'}:{summary:'No other gaps',gaps:[]},outputTokens:0})});
  assert.equal(output.result.status,'incomplete');assert.equal(output.result.stopReason,'maxRounds');assert.equal(output.result.stoppedAfterDryRounds,false);
  assert.ok(output.result.unresolvedGaps.includes('Review stopped at maxRounds=1 before convergence'));
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('the thousand-agent backstop fails explicitly before an oversized finder batch starts',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'explicit-agent-limit-'));let calls=0;
 try{
  await assert.rejects(runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:Array(1001).fill('src')},agent:async()=>{calls++;return {result:{findings:[]},outputTokens:0};}}),/1000-agent call limit; coverage is incomplete/);
  assert.equal(calls,0);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('an exhausted output-token budget returns incomplete pending evidence without another batch or critic',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'exhaustive-budget-'));let calls=0;
 try{
  const output=await runWorkflow({runDir,budget:1,script:await readFile(template,'utf8'),args:{topics:['src']},agent:async()=>{calls++;return {result:{findings:[issue('claim')]},outputTokens:1};}});
  assert.equal(output.result.status,'incomplete');assert.equal(output.result.stopReason,'budget');assert.equal(output.result.rounds,1);assert.equal(calls,1);
  assert.deepEqual(output.result.unverified,[{finding:issue('claim'),missingLenses:['correctness','security','reproducibility']}]);
  assert.ok(output.result.unresolvedGaps.includes('Output-token budget exhausted before review convergence'));
  assert.equal(output.result.critique,undefined);
 }finally{await rm(runDir,{recursive:true,force:true});}
});


test('a thrown verifier preserves successful sibling votes and records its actual failure',async()=>{
 const runDir=await mkdtemp(join(tmpdir(),'thrown-panel-')),calls={correctness:0,security:0,reproducibility:0};
 try{
  const output=await runWorkflow({runDir,script:await readFile(template,'utf8'),args:{topics:['src']},agent:async prompt=>{
   if(prompt.startsWith('Round'))return {result:{findings:[issue('claim')]},outputTokens:0};
   if(prompt.startsWith('Try')){const lens=Object.keys(calls).find(lens=>prompt.includes(`through ${lens}:`));calls[lens]++;if(lens==='security'&&calls[lens]===1)throw Error('security callback failed');return {result:{real:true,reason:'Confirmed'},outputTokens:0};}
   return {result:{summary:'Complete',gaps:[]},outputTokens:0};
  }});
  assert.deepEqual(calls,{correctness:1,security:2,reproducibility:1});
  assert.equal(output.result.status,'complete');assert.deepEqual(output.result.confirmed,[issue('claim')]);assert.deepEqual(output.result.unverified,[]);
  assert.ok(output.failures.some(failure=>failure.includes('security callback failed')),'catching a lens failure must not erase the actual failure record');
 }finally{await rm(runDir,{recursive:true,force:true});}
});
