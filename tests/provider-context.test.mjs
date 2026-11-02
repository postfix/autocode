import test from 'node:test';
import assert from 'node:assert/strict';
import {claudeAgent} from '../scripts/claude-adapter.mjs';
test('Claude receives orchestration instructions as system instructions and the task separately',async()=>{
 let received;
 const query=input=>{received=input;return (async function*(){yield {type:'result',subtype:'success',result:'done',usage:{output_tokens:1}};})();};
 await claudeAgent('TASK_ONLY',{}, {query,runDir:process.cwd()});
 assert.equal(received.prompt,'TASK_ONLY');
 assert.match(received.options.systemPrompt,/subagent spawned by a workflow/);
});

test('Codex receives orchestration instructions above the task message',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 let config,task;
 class FakeCodex {constructor(options){config=options?.config;}startThread(){return {run:async prompt=>{task=prompt;return {finalResponse:'done',usage:{output_tokens:1}};}};}}
 await codexAgent('TASK_ONLY',{}, {Codex:FakeCodex,runDir:process.cwd()});
 assert.equal(task,'TASK_ONLY');
 assert.match(config.developer_instructions,/subagent spawned by a workflow/);
});

test('Claude custom agents use the trusted registry prompt and workflow return instructions',async()=>{
 let system;
 const query=({options})=>{system=options.systemPrompt;return (async function*(){yield {type:'result',subtype:'success',result:'done',usage:{output_tokens:1}};})();};
 await claudeAgent('inspect',{agentType:'reviewer'}, {query,runDir:process.cwd(),hostContext:{agents:{reviewer:{prompt:'CUSTOM_REVIEW_POLICY'}}}});
 assert.match(system,/CUSTOM_REVIEW_POLICY/);
 assert.match(system,/return value/);
});

test('Claude applies custom-agent tool limits and per-call denials',async()=>{
 let tools,denied;
 const query=({options})=>{tools=options.tools;denied=options.disallowedTools;return (async function*(){yield {type:'result',subtype:'success',result:'done',usage:{output_tokens:1}};})();};
 await claudeAgent('inspect',{agentType:'reader',disallowedTools:['Grep']}, {query,runDir:process.cwd(),hostContext:{agents:{reader:{prompt:'Read only',tools:['Read'],disallowedTools:['Write']}}}});
 assert.deepEqual(tools,['Read']);
 assert.deepEqual(denied,['Write','Grep']);
});

test('Claude receives trusted host instructions and MCP configuration',async()=>{
 let options;
 const query=input=>{options=input.options;return (async function*(){yield {type:'result',subtype:'success',result:'done',usage:{output_tokens:1}};})();};
 const mcpServers={fixture:{command:'fixture-mcp'}};
 await claudeAgent('inspect',{}, {query,runDir:process.cwd(),hostContext:{instructions:'HOST_PROJECT_RULE',providers:{claude:{mcpServers}}}});
 assert.match(options.systemPrompt,/HOST_PROJECT_RULE/);
 assert.deepEqual(options.mcpServers,mcpServers);
});

test('Codex custom agents inherit trusted project instructions',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');
 let instructions;
 class FakeCodex {constructor(options){instructions=options.config.developer_instructions;}startThread(){return {run:async()=>({finalResponse:'done',usage:{output_tokens:1}})};}}
 await codexAgent('inspect',{agentType:'reviewer'},{runDir:process.cwd(),Codex:FakeCodex,hostContext:{instructions:'HOST_POLICY',agents:{reviewer:{prompt:'CUSTOM_REVIEW_POLICY'}}}});
 assert.match(instructions,/HOST_POLICY/);
 assert.match(instructions,/CUSTOM_REVIEW_POLICY/);
});

test('Claude forwards host permission decisions without disabling permission callbacks',async()=>{
 let options;
 const canUseTool=async()=>({behavior:'deny',message:'host policy'});
 const query=input=>{options=input.options;return (async function*(){yield {type:'result',subtype:'success',result:'done',usage:{output_tokens:1}};})();};
 await claudeAgent('inspect',{}, {query,runDir:process.cwd(),hostContext:{canUseTool}});
 assert.equal(options.canUseTool,canUseTool);
 assert.equal(options.permissionPrompts,'host');
});

test('Claude workspace-write agents can run authorized build and test commands',async()=>{
 let options;
 const query=input=>{options=input.options;return (async function*(){yield {type:'result',subtype:'success',result:'done',usage:{output_tokens:1}};})();};
 await claudeAgent('run the tests',{sandbox:'workspace-write'}, {query,runDir:process.cwd()});
 assert.equal(options.tools.includes('Bash'),true);
});

test('custom structured agents receive the recovered custom-agent return suffix',async()=>{
 let system;
 const query=({options})=>{system=options.systemPrompt;return (async function*(){yield {type:'result',subtype:'success',structured_output:{},usage:{output_tokens:1}};})();};
 await claudeAgent('inspect',{agentType:'reviewer',schema:{type:'object',properties:{},required:[]}},{query,runDir:process.cwd(),hostContext:{agents:{reviewer:{prompt:'CUSTOM_POLICY'}}}});
 assert.match(system,/NOTE: You are running inside a workflow script/);
 assert.doesNotMatch(system,/calling the StructuredOutput tool/);
});

test('Codex workflow agents disable untracked nested multi-agent spawning',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');let config;
 class FakeCodex {constructor(options){config=options.config;}startThread(){return {run:async()=>({finalResponse:'done',usage:{output_tokens:0}})};}}
 await codexAgent('inspect',{}, {runDir:process.cwd(),Codex:FakeCodex});
 assert.equal(config.features?.multi_agent,false);
});

test('Codex can initialize state in a trusted writable home supplied by the host',async()=>{
 const {codexAgent}=await import('../scripts/codex-adapter.mjs');let home;
 class FakeCodex {constructor(options){home=options.env?.CODEX_HOME;}startThread(){return {run:async()=>({finalResponse:'done',usage:{output_tokens:0}})};}}
 await codexAgent('inspect',{}, {runDir:process.cwd(),Codex:FakeCodex,hostContext:{providers:{codex:{codexHome:'/workspace/.agent-state'}}}});
 assert.equal(home,'/workspace/.agent-state');
});

test('Claude preserves provider completion metadata for degraded response recovery',async()=>{
 const query=()=> (async function*(){yield {type:'result',subtype:'success',result:'short',duration_ms:95000,stop_reason:null,usage:{output_tokens:4}};})();
 const response=await claudeAgent('inspect',{}, {query,runDir:process.cwd()});
 assert.equal(response.durationMs,95000);
 assert.equal(response.stopReason,null);
});

test('Claude signals a genuine first response before completion',async()=>{
 let responded=false;
 const query=()=> (async function*(){yield {type:'system',subtype:'init'};assert.equal(responded,false);yield {type:'assistant',message:{content:[{type:'text',text:'answer'}]}};assert.equal(responded,true);yield {type:'result',subtype:'success',result:'answer',usage:{output_tokens:1}};})();
 await claudeAgent('inspect',{}, {query,runDir:process.cwd(),onResponse:()=>{responded=true;}});
});

test('Claude reports cumulative input and cache usage across structured repairs',async()=>{
 let calls=0,usage;
 const query=()=> (async function*(){const turn=++calls;yield {type:'result',subtype:'success',structured_output:{answer:turn===1?'invalid':42},usage:{output_tokens:1,input_tokens:turn*10,cache_read_input_tokens:turn*2}};})();
 await claudeAgent('inspect',{schema:{type:'object',properties:{answer:{type:'integer'}},required:['answer']}},{query,runDir:process.cwd(),onUsage:value=>{usage={...usage,...value};}});
 assert.equal(usage.inputTokens,36);
 assert.equal(usage.cachedInputTokens,6);
});

test('Claude custom agents use the native root registry to restrict exact MCP tools',async()=>{
 let options;
 const query=input=>{options=input.options;return(async function*(){yield {type:'result',subtype:'success',result:'done',usage:{output_tokens:0}};})();};
 await claudeAgent('inspect',{agentType:'pinger',model:'forced-model'},{runDir:process.cwd(),query,hostContext:{instructions:'HOST_POLICY',agents:{pinger:{prompt:'CUSTOM_POLICY',tools:['mcp__parity__ping']}}}});
 assert.equal(options.agent,'autocode-workflow');
 assert.deepEqual(options.agents['autocode-workflow'].tools,['mcp__parity__ping']);
 assert.match(options.agents['autocode-workflow'].prompt,/HOST_POLICY/);
 assert.match(options.agents['autocode-workflow'].prompt,/CUSTOM_POLICY/);
 assert.equal(options.model,'forced-model');
 assert.equal(options.agents['autocode-workflow'].model,undefined);
 assert.ok(!options.disallowedTools?.includes('mcp__*'));
});

test('Claude routes trusted automatic tools through the host permission callback',async()=>{
 const policy=async()=>({behavior:'deny',message:'host denied'});let options;
 const query=input=>{options=input.options;return(async function*(){yield {type:'result',subtype:'success',result:'done',usage:{output_tokens:0}};})();};
 await claudeAgent('inspect',{}, {query,runDir:process.cwd(),hostContext:{canUseTool:policy}});
 assert.equal(typeof options.hooks?.PreToolUse?.[0]?.hooks?.[0],'function');
 const result=await options.hooks.PreToolUse[0].hooks[0]({tool_name:'Read',tool_input:{file_path:'fixture'},tool_use_id:'read-1'},'read-1',{});
 assert.equal(result.hookSpecificOutput.permissionDecision,'ask');
 assert.equal(options.canUseTool,policy);
 assert.equal(options.permissionMode,'default');
});
