import test from 'node:test';
import assert from 'node:assert/strict';
import {claudeAgent} from '../scripts/claude-adapter.mjs';
test('Claude reports output usage even when the SDK result fails',async()=>{
 let usage;
 const query=()=> (async function*(){yield {type:'result',subtype:'error_max_turns',is_error:true,usage:{output_tokens:11,input_tokens:2}};})();
 await assert.rejects(claudeAgent('probe',{}, {query,runDir:process.cwd(),onUsage:value=>usage=value}),/Claude SDK failed/);
 assert.equal(usage?.outputTokens,11);
});

test('Codex reports spent tokens before structured-output parsing can fail',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 let usage;
 class FakeCodex {startThread(){return {run:async()=>({finalResponse:'invalid JSON',usage:{output_tokens:13}})};}}
 await assert.rejects(codexAgent('probe',{schema:{type:'object',properties:{},required:[]}},{Codex:FakeCodex,runDir:process.cwd(),onUsage:value=>usage=value}));
 assert.equal(usage?.outputTokens,39);
});

test('Claude distinguishes terminal API refusal from workflow programming errors',async()=>{
 const query=()=> (async function*(){yield {type:'assistant',error:'model_not_found',message:{content:[]}};yield {type:'result',subtype:'error_during_execution',is_error:true,usage:{output_tokens:0}};})();
 await assert.rejects(claudeAgent('probe',{}, {query,runDir:process.cwd()}),error=>error.kind==='terminal-api');
});

test('both providers distinguish missing usage from reported zero usage',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 class FakeCodex {startThread(){return {run:async()=>({finalResponse:'done'})};}}
 const query=()=> (async function*(){yield {type:'result',subtype:'success',result:'done'};})();
 const codex=await codexAgent('probe',{}, {Codex:FakeCodex,runDir:process.cwd()});
 const claude=await claudeAgent('probe',{}, {query,runDir:process.cwd()});
 assert.deepEqual([codex.usageIncomplete,claude.usageIncomplete],[true,true]);
});

test('Claude retains API-failure classification for unrecognized assistant error categories',async()=>{
 const query=()=> (async function*(){yield {type:'assistant',error:'unknown',message:{content:[]}};yield {type:'result',subtype:'error_during_execution',usage:{output_tokens:1}};})();
 await assert.rejects(claudeAgent('probe',{}, {query,runDir:process.cwd()}),error=>error.kind==='api-error');
});
