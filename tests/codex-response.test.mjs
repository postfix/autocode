import test from 'node:test';
import assert from 'node:assert/strict';
import {codexAgent} from '../scripts/codex-adapter.mjs';

test('Codex marks first model output before a streamed turn completes',async()=>{
 let responded=false;
 class FakeCodex {startThread(){return {runStreamed:async()=>({events:(async function*(){
  yield {type:'turn.started'};assert.equal(responded,false);
  yield {type:'item.started',item:{type:'reasoning',id:'thinking',text:'reasoning'}};
  assert.equal(responded,true);
  yield {type:'item.completed',item:{type:'agent_message',text:'done'}};
  yield {type:'turn.completed',usage:{output_tokens:1}};
 })()})};}}
 const output=await codexAgent('answer',{}, {runDir:process.cwd(),Codex:FakeCodex,onActivity:()=>{},onResponse:()=>{responded=true;}});
 assert.equal(output.result,'done');
});

test('Codex tool requests count as model responses before their tools complete',async()=>{
 let responded=false;
 class FakeCodex {startThread(){return {runStreamed:async()=>({events:(async function*(){
  yield {type:'item.started',item:{type:'command_execution',id:'command',command:'pwd',status:'in_progress'}};
  assert.equal(responded,true);
  yield {type:'item.completed',item:{type:'agent_message',text:'done'}};
  yield {type:'turn.completed',usage:{output_tokens:1}};
 })()})};}}
 await codexAgent('answer',{}, {runDir:process.cwd(),Codex:FakeCodex,onActivity:()=>{},onResponse:()=>{responded=true;}});
});

test('Codex streamed provider failures retain their typed recovery metadata',async()=>{
 class FakeCodex {startThread(){return {runStreamed:async()=>({events:(async function*(){yield {type:'turn.failed',error:{message:'quota exhausted',kind:'rate-limit',rateLimit:{resetAt:42},replyLost:false}};})()})};}}
 await assert.rejects(codexAgent('answer',{}, {runDir:process.cwd(),Codex:FakeCodex,onActivity:()=>{}}),error=>error.message==='quota exhausted'&&error.kind==='rate-limit'&&error.rateLimit.resetAt===42&&error.replyLost===false);
});

test('Codex closes persistent provider threads after success and provider failure',async()=>{
 for(const fail of [false,true]) {
  let closed=0;
  class FakeCodex {startThread(){return {run:async()=>{if(fail)throw Error('provider failed');return {finalResponse:'done',usage:{output_tokens:1}};},close:async()=>{closed++;}};}}
  if(fail)await assert.rejects(codexAgent('answer',{}, {runDir:process.cwd(),Codex:FakeCodex}),/provider failed/);
  else assert.equal((await codexAgent('answer',{}, {runDir:process.cwd(),Codex:FakeCodex})).result,'done');
  assert.equal(closed,1);
 }
});

test('Codex charges measured failed-turn usage after earlier schema repair usage',async()=>{
 let calls=0,lastUsage;
 class FakeCodex {startThread(){return {runStreamed:async()=>({events:(async function*(){
  calls++;
  if(calls===1){yield {type:'item.completed',item:{type:'agent_message',text:'invalid JSON'}};yield {type:'turn.completed',usage:{output_tokens:2,input_tokens:5,cached_input_tokens:1}};}
  else throw Object.assign(Error('native failure'),{kind:'terminal-api',usage:{output_tokens:3,input_tokens:7,cached_input_tokens:2}});
 })()})};}}
 await assert.rejects(codexAgent('answer',{schema:{type:'object',properties:{answer:{type:'integer'}},required:['answer']}},{runDir:process.cwd(),Codex:FakeCodex,onActivity:()=>{},onUsage:usage=>{lastUsage=usage;}}),error=>error.kind==='terminal-api');
 assert.deepEqual(lastUsage,{outputTokens:5,inputTokens:12,cachedInputTokens:3});
});

test('Codex exec failures classify exact API envelopes while retaining measured usage',async()=>{
 let usage;
 class FakeCodex {startThread(){return {run:async()=>{throw Object.assign(Error(JSON.stringify({type:'error',status:400,error:{type:'invalid_request_error',code:'model_not_found'}})),{usage:{output_tokens:3}});}};}}
 await assert.rejects(codexAgent('answer',{}, {runDir:process.cwd(),Codex:FakeCodex,onUsage:counts=>{usage=counts;}}),error=>error.kind==='terminal-api'&&error.apiError.code==='model_not_found');
 assert.equal(usage.outputTokens,3);
});
