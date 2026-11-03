import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runWorkflow} from '../scripts/runtime.mjs';

const schema={type:'object',properties:{findings:{type:'array',items:{type:'object',properties:{file:{type:'string'},line:{type:'integer'},title:{type:'string'}},required:['file','line','title']}}},required:['findings']};
async function runCountExample(args,batches){
 const prose=await readFile(new URL('../references/quality-patterns.md',import.meta.url),'utf8');
 const match=/For a fixed target,[\s\S]*?```js\n([\s\S]*?)```/.exec(prose);
 assert.ok(match,'published fixed-target code example must exist');
 const runDir=await mkdtemp(join(tmpdir(),'authoring-count-'));
 let calls=0;
 try{
  return await runWorkflow({runDir,args:{...args,findingsSchema:schema},script:`export const meta={name:'count-example',description:'Published count example'};\n${match[1]}`,agent:async()=>{
   const batch=batches[calls++];
   if(batch instanceof Error)throw batch;
   return {result:structuredClone(batch??{findings:[]}),outputTokens:1};
  }});
 }finally{await rm(runDir,{recursive:true,force:true});}
}

test('published count example reaches its documented target without an undocumented cap argument',async()=>{
 const finding={file:'src/a.js',line:3,title:'A demonstrated defect'};
 const output=await runCountExample({target:1,maxRounds:1},[{findings:[finding]}]);
 assert.deepEqual(output.result,[finding]);
});

test('published count example counts structurally repeated findings only once',async()=>{
 await fc.assert(fc.asyncProperty(fc.record({line:fc.integer({min:1,max:100}),title:fc.string({minLength:1,maxLength:30})}),fc.boolean(),async(value,repeatWithinBatch)=>{
  const first={file:'src/a.js',...value};
  const second={file:'src/b.js',...value};
  const firstBatch=repeatWithinBatch?[first,structuredClone(first)]:[first];
  const output=await runCountExample({target:2,maxRounds:2},[{findings:firstBatch},{findings:[structuredClone(first),second]}]);
  assert.deepEqual(output.result,[first,second]);
 }),{seed:20261103,numRuns:30});
});

test('published count example reports a skipped discovery as an explicit shortfall',async()=>{
 const skipped=Object.assign(Error('User skipped this discovery'),{code:'user-skip'});
 const output=await runCountExample({target:2,maxRounds:2},[skipped]);
 assert.deepEqual(output.result,[]);
 assert.equal(output.agentCount,1);
 assert.ok(output.logs.some(entry=>/no result|skipped/i.test(entry.message)));
 assert.ok(output.logs.some(entry=>entry.message.includes('0/2')&&/short|missing/i.test(entry.message)));
});

test('published count example logs every unique finding omitted at the target cap',async()=>{
 await fc.assert(fc.asyncProperty(fc.integer({min:1,max:5}),fc.integer({min:1,max:5}),async(target,omitted)=>{
  const batch=Array.from({length:target+omitted},(_,index)=>({file:`src/${index}.js`,line:1,title:`Finding ${index}`}));
  const output=await runCountExample({target,maxRounds:1},[{findings:batch}]);
  assert.equal(output.result.length,target);
  assert.ok(output.logs.some(entry=>/omitted|dropped|truncat/i.test(entry.message)&&entry.message.includes(String(omitted))));
 }),{seed:20261103,numRuns:20});
});

test('published count example retains discoveries and exposes bounded or terminal shortfalls',async()=>{
 const finding={file:'src/a.js',line:3,title:'A demonstrated defect'};
 const capped=await runCountExample({target:3,maxRounds:1},[{findings:[finding]}]);
 assert.deepEqual(capped.result,[finding]);
 assert.ok(capped.logs.some(entry=>entry.message.includes('1/3')&&entry.message.includes('2 missing')));
 const dry=await runCountExample({target:3,maxRounds:2},[{findings:[finding]},{findings:[structuredClone(finding)]}]);
 assert.deepEqual(dry.result,[finding]);
 assert.ok(dry.logs.some(entry=>entry.message.includes('1/3')&&entry.message.includes('2 missing')));
 const refused=Object.assign(Error('Provider rejected this request'),{kind:'terminal-api'});
 const terminal=await runCountExample({target:1,maxRounds:2},[refused]);
 assert.deepEqual(terminal.result,[]);
 assert.equal(terminal.failures.length,1);
 assert.ok(terminal.logs.some(entry=>entry.message.includes('0/1')&&entry.message.includes('1 missing')));
});

test('published research example deep-reads unique sources before its completeness check',async()=>{
 const prose=await readFile(new URL('../references/quality-patterns.md',import.meta.url),'utf8');
 const script=/## Worked workflow: multi-modal research and completeness[\s\S]*?```js\n([\s\S]*?)```/.exec(prose)[1];
 const runDir=await mkdtemp(join(tmpdir(),'authoring-research-'));const reads=[];let criticSawReads=false;
 try{
  const output=await runWorkflow({runDir,script,args:{question:'a question'},agent:async(prompt,opts)=>{
   if(opts.phase==='Sweep')return {result:{sources:['source-a','source-b']},outputTokens:0};
   if(opts.phase==='Read'){reads.push(prompt);return {result:{source:prompt.includes('source-a')?'source-a':'source-b',evidence:'concrete source evidence',unreadable:false},outputTokens:0};}
   criticSawReads=reads.length===2;return {result:{summary:'checked',gaps:[]},outputTokens:0};
  }});
  assert.equal(reads.length,2);
  assert.equal(criticSawReads,true);
  assert.equal(output.result.material.length,2);
  assert.deepEqual(output.result.unresolvedGaps,[]);
 }finally{await rm(runDir,{recursive:true,force:true});}
});
