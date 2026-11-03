import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';
import {claudeAgent} from '../scripts/claude-adapter.mjs';

const finding={file:'src/cart.js',line:12,description:'Zero quantity is accepted'};
async function runReview(respond){
 const runDir=await mkdtemp(join(tmpdir(),'review-prose-'));
 const script=await readFile(new URL('../assets/templates/review-and-verify.js',import.meta.url),'utf8');
 const prompts=[],queries=[];
 try{
  const output=await runWorkflow({runDir,script,args:{topics:['src/cart.js']},agent:async(prompt,options,context)=>{
   prompts.push({prompt,options});
   return claudeAgent(prompt,options,{...context,query:request=>{
    queries.push({prompt:request.prompt,phase:options.phase});
    return (async function*(){
     yield {type:'result',subtype:'success',structured_output:await respond(prompt,options),usage:{output_tokens:1}};
    })();
   }});
  }});
  return {output,prompts,queries};
 }finally{await rm(runDir,{recursive:true,force:true});}
}

test('basic review returns source-located findings with validated verifier evidence',async()=>{
 const verdict={real:true,reason:'At src/cart.js:12, validateQuantity(0) accepts zero despite the minimum of one.'};
 const {output}=await runReview((_prompt,options)=>options.phase==='Review'?{findings:[finding]}:verdict);
 assert.deepEqual(output.result,[{finding,verdict}]);
 assert.deepEqual(output.failures,[]);
});

test('basic verifier receives the complete structured finding and an explicit evidence requirement',async()=>{
 const {prompts}=await runReview((_prompt,options)=>options.phase==='Review'?{findings:[finding]}:{real:false,reason:'The documented policy permits this behavior.'});
 const verifier=prompts.find(item=>item.options.phase==='Verify');
 assert.ok(verifier);
 assert.ok(verifier.prompt.includes(JSON.stringify(finding)),'verification must receive source coordinates and description as JSON');
 assert.match(verifier.prompt,/evidence.*reason|reason.*evidence/i);
 assert.match(verifier.prompt,/false.*uncertain/i);
 assert.ok(!verifier.prompt.includes('[object Object]'));
});

test('basic review logs a skipped verifier as unresolved coverage with its finding',async()=>{
 const {output}=await runReview((_prompt,options)=>{
  if(options.phase==='Review')return {findings:[finding]};
  throw Object.assign(Error('Verifier skipped'),{code:'user-skip'});
 });
 assert.deepEqual(output.result,[]);
 assert.equal(output.agentCount,2);
 assert.ok(output.logs.some(entry=>/unresolved|unverified/i.test(entry.message)&&entry.message.includes(JSON.stringify(finding))));
});

test('basic review logs failed verification as unresolved while retaining the actual failure',async()=>{
 const {output}=await runReview((_prompt,options)=>{
  if(options.phase==='Review')return {findings:[finding]};
  throw Error('Verifier transport failed');
 });
 assert.deepEqual(output.result,[]);
 assert.ok(output.failures.some(message=>message.includes('Verifier transport failed')));
 assert.ok(output.logs.some(entry=>/unresolved|unverified/i.test(entry.message)&&entry.message.includes(JSON.stringify(finding))));
});

test('basic review never confirms a finding on a blank verification reason',async()=>{
 const {output,queries}=await runReview((_prompt,options)=>options.phase==='Review'?{findings:[finding]}:{real:true,reason:'   '});
 assert.deepEqual(output.result,[]);
 assert.equal(queries.filter(item=>item.phase==='Verify').length,3);
 assert.ok(output.failures.some(message=>message.includes('schema validation')));
 assert.ok(output.logs.some(entry=>/unresolved|unverified/i.test(entry.message)));
});
