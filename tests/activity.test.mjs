import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runWorkflow} from '../scripts/runtime.mjs';
import {readRunStatus,safeText} from '../scripts/run-stats.mjs';
import {codexAgent} from '../scripts/codex-adapter.mjs';
import {claudeAgent} from '../scripts/claude-adapter.mjs';

test('Codex streamed tool errors and usage remain visible when the agent succeeds', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'autocode-codex-activity-'));
  class FakeCodex{startThread(){return {runStreamed:async()=>({events:(async function*(){
    yield {type:'item.started',item:{id:'tool1',type:'command_execution',status:'in_progress'}};
    yield {type:'item.completed',item:{id:'tool1',type:'command_execution',status:'completed',exit_code:2,aggregated_output:'missing fixture; Authorization: Bearer PRIVATE_TOKEN'}};
    yield {type:'item.completed',item:{id:'reply',type:'agent_message',text:'fixed'}};
    yield {type:'turn.completed',usage:{input_tokens:20,cached_input_tokens:5,output_tokens:3}};
  })()})};}}
  try{
    const result=await runWorkflow({runDir:dir,script:'export const meta={name:"stream",description:"Inspect SDK events"};return await agent("check",{provider:"codex",label:"check"});',agent:(p,o,c)=>codexAgent(p,o,{...c,Codex:FakeCodex})});
    assert.equal(result.result,'fixed');
    const status=await readRunStatus(dir);
    assert.equal(status.agents[0].state,'completed');assert.equal(status.errorCount,1);
    assert.equal(status.agents[0].activity.length,1);assert.equal(status.agents[0].activity[0].exitCode,2);
    assert.equal(status.inputTokens,20);assert.equal(status.cachedInputTokens,5);assert.equal(status.outputTokens,3);
    assert.match(status.agents[0].activity[0].message,/missing fixture/);assert.doesNotMatch(JSON.stringify(status),/PRIVATE_TOKEN/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('Claude tool failures are retained independently of successful final results', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'autocode-claude-activity-'));
  const query=()=> (async function*(){
    yield {type:'assistant',message:{content:[{type:'tool_use',id:'t1',name:'Read'}]}};
    yield {type:'user',message:{content:[{type:'tool_result',tool_use_id:'t1',is_error:true,content:'File not found'}]}};
    yield {type:'result',subtype:'success',result:'recovered',usage:{input_tokens:10,cache_read_input_tokens:4,cache_creation_input_tokens:2,output_tokens:3}};
  })();
  try{
    await runWorkflow({runDir:dir,script:'export const meta={name:"claude",description:"Inspect SDK events"};return await agent("check");',agent:(p,o,c)=>claudeAgent(p,o,{...c,query})});
    const status=await readRunStatus(dir);assert.equal(status.state,'completed');assert.equal(status.errorCount,1);
    assert.equal(status.agents[0].activity[0].tool,'Read');assert.match(status.agents[0].activity[0].message,/File not found/);
    assert.equal(status.agents[0].activity[0].exitCode,null,'missing exit status is not invented');
    assert.equal(status.inputTokens,16);assert.equal(status.cachedInputTokens,4);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('terminal output removes control sequences and credential-shaped error values',()=>{
  const text=safeText('\x1b[31mOops\x1b[0m Authorization: Bearer SECRET_BEARER {"api_key":"SECRET_JSON"} password=SECRET_PASSWORD');
  assert.doesNotMatch(text,/SECRET_|\x1b/);assert.match(text,/Oops/);
});

test('bounded activity does not discard the actual agent failure',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'autocode-bounded-'));
  try{
    await assert.rejects(runWorkflow({runDir:dir,script:'export const meta={name:"bounded",description:"Bound recorded activity"};return await agent("check");',agent:async(_p,_o,c)=>{for(let n=0;n<1100;n++)c.onActivity({id:String(n),tool:'Read',status:'completed'});throw Error('final failure');}}),/final failure/);
    const status=await readRunStatus(dir);assert.equal(status.activityTruncated,true);assert.equal(status.agents[0].activity.length,20);assert.match(status.agents[0].error,/final failure/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
