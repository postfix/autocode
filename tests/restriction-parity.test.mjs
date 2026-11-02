import test from 'node:test';
import assert from 'node:assert/strict';
import {codexAgent} from '../scripts/codex-adapter.mjs';

test('Codex refuses restrictions it cannot enforce instead of silently dropping them',async()=>{
 class FakeCodex {startThread(){return {run:async()=>({finalResponse:'unrestricted',usage:{output_tokens:1}})};}}
 await assert.rejects(codexAgent('inspect',{disallowedTools:['UnsupportedNativeTool']},{runDir:process.cwd(),Codex:FakeCodex}),/disallowedTools.*cannot enforce/);
});

test('workflow options cannot silently request an unsupported capability',async()=>{
 const {runWorkflow}=await import('../scripts/runtime.mjs');
 const {mkdtemp,rm}=await import('node:fs/promises');
 const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const runDir=await mkdtemp(join(tmpdir(),'unsupported-option-'));
 try {
  await assert.rejects(runWorkflow({runDir,script:'export const meta={name:"options",description:"options"};return agent("inspect",{isolationMode:"worktree"});',agent:async()=>({result:'unrestricted',outputTokens:0})}),/unsupported agent option/);
 }finally{await rm(runDir,{recursive:true,force:true});}
});

test('Codex refuses a host permission policy it cannot consult',async()=>{
 class FakeCodex {startThread(){return {run:async()=>({finalResponse:'unrestricted',usage:{output_tokens:0}})};}}
 await assert.rejects(codexAgent('inspect',{}, {runDir:process.cwd(),Codex:FakeCodex,hostContext:{canUseTool:async()=>({behavior:'deny',message:'host policy'})}}),/cannot enforce host permission/);
});

test('Codex enforces Bash denial through its native command-tool switch',async()=>{
 let config;
 class FakeCodex {constructor(options){config=options.config;}startThread(){return {run:async()=>({finalResponse:'done',usage:{output_tokens:0}})};}}
 await codexAgent('inspect',{disallowedTools:['Bash']},{runDir:process.cwd(),Codex:FakeCodex});
 assert.equal(config.features.shell_tool,false);
});

test('Claude refuses misspelled built-in denials before starting a provider',async()=>{
 const {claudeAgent}=await import('../scripts/claude-adapter.mjs');
 let started=false;
 const query=()=>{started=true;return(async function*(){yield {type:'result',subtype:'success',result:'unrestricted',usage:{output_tokens:0}};})();};
 await assert.rejects(claudeAgent('inspect',{disallowedTools:['read']},{runDir:process.cwd(),query}),/disallowedTools.*case-sensitive/);
 assert.equal(started,false);
});

test('Claude refuses malformed denial rules that cannot match native tools',async()=>{
 const {claudeAgent}=await import('../scripts/claude-adapter.mjs');
 const query=()=> (async function*(){yield {type:'result',subtype:'success',result:'unrestricted',usage:{output_tokens:0}};})();
 for(const rule of ['Read (file)','Read(file','Read)','Ba*','mcp__','mcp__serv*__tool','mcp__server__to*']){
  await assert.rejects(claudeAgent('inspect',{disallowedTools:[rule]},{runDir:process.cwd(),query}),/disallowedTools.*cannot match/,rule);
 }
});

test('Claude refuses malformed trusted registry tool restrictions before provider startup',async()=>{
 const {claudeAgent}=await import('../scripts/claude-adapter.mjs');
 const query=()=>{throw Error('provider must not start');};
 for(const limits of [{disallowedTools:'Bash'},{tools:'ReadGrep'},{disallowedTools:[null]},{tools:[null]}])
  await assert.rejects(claudeAgent('inspect',{agentType:'reviewer',sandbox:'workspace-write'},{runDir:process.cwd(),query,hostContext:{agents:{reviewer:{prompt:'review',...limits}}}}),/agent registry.*tool/);
});

test('Claude builtin-only custom agents cannot inherit unrestricted MCP tools',async()=>{
 const {claudeAgent}=await import('../scripts/claude-adapter.mjs');let options;
 const query=input=>{options=input.options;return(async function*(){yield {type:'result',subtype:'success',result:'done',usage:{output_tokens:0}};})();};
 await claudeAgent('inspect',{agentType:'reader'},{runDir:process.cwd(),query,hostContext:{agents:{reader:{prompt:'read',tools:['Read']}},providers:{claude:{mcpServers:{external:{command:'fixture'}}}}}});
 assert.equal(options.agent,'autocode-workflow');
 assert.deepEqual(options.agents['autocode-workflow'].tools,['Read']);
});

test('Claude rejects malformed host permission policies before provider startup',async()=>{
 const {claudeAgent}=await import('../scripts/claude-adapter.mjs');
 const query=()=> (async function*(){yield {type:'result',subtype:'success',result:'unrestricted',usage:{output_tokens:0}};})();
 for(const canUseTool of [null,'deny',{},42])await assert.rejects(claudeAgent('inspect',{}, {runDir:process.cwd(),query,hostContext:{canUseTool}}),/canUseTool.*function/);
});

test('Codex treats an empty optional command clamp as no restriction',async()=>{
 class FakeCodex{startThread(){return {run:async()=>({finalResponse:'ordinary result',usage:{output_tokens:0}})};}}
 const output=await codexAgent('inspect',{bashCommandClamp:[]},{runDir:process.cwd(),Codex:FakeCodex});
 assert.equal(output.result,'ordinary result');
});

test('Claude treats an empty optional command clamp as no restriction',async()=>{
 const {claudeAgent}=await import('../scripts/claude-adapter.mjs');
 const query=()=> (async function*(){yield {type:'result',subtype:'success',result:'ordinary result',usage:{output_tokens:0}};})();
 const output=await claudeAgent('inspect',{bashCommandClamp:[]},{runDir:process.cwd(),query});
 assert.equal(output.result,'ordinary result');
});
