import test from 'node:test';
import assert from 'node:assert/strict';
import {claudeAgent} from '../scripts/claude-adapter.mjs';
import {codexAgent} from '../scripts/codex-adapter.mjs';
test('custom structured agent instructions identify the supplied schema rather than an unavailable tool',async()=>{
 let delivered;
 const query=({options})=>{delivered=options.systemPrompt;return(async function*(){yield {type:'result',subtype:'success',structured_output:{},usage:{output_tokens:0}};})();};
 await claudeAgent('inspect',{agentType:'reviewer',schema:{type:'object',properties:{},additionalProperties:false}}, {query,runDir:process.cwd(),hostContext:{agents:{reviewer:{prompt:'CUSTOM_REVIEW'}}}});
 assert.match(delivered,/supplied JSON schema defines the required shape/);
 assert.doesNotMatch(delivered,/the tool's input schema/);
});

test('empty registered custom prompts retain the custom suffix for both providers and output modes',async()=>{
 for(const provider of ['claude','codex'])for(const structured of [false,true]){
  let delivered;
  const options={agentType:'reviewer',...(structured?{schema:{type:'object',properties:{},required:[],additionalProperties:false}}:{})};
  const hostContext={agents:{reviewer:{prompt:''}}};
  if(provider==='claude'){
   const query=({options})=>{delivered=options.systemPrompt;return(async function*(){yield {type:'result',subtype:'success',result:'done',structured_output:{},usage:{output_tokens:0}};})();};
   await claudeAgent('inspect',options,{query,hostContext,runDir:process.cwd()});
  }else{
   class FakeCodex{constructor(options){delivered=options.config.developer_instructions;}startThread(){return {run:async()=>({finalResponse:structured?'{}':'done',usage:{output_tokens:0}})};}}
   await codexAgent('inspect',options,{Codex:FakeCodex,hostContext,runDir:process.cwd()});
  }
  assert.match(delivered,/NOTE: You are running inside a workflow script/,`${provider} ${structured?'structured':'text'} must retain the selected custom-agent suffix`);
  assert.doesNotMatch(delivered,/You are a subagent spawned by a workflow orchestration script/);
 }
});
