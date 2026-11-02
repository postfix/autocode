import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {codexAgent} from '../scripts/codex-adapter.mjs';
async function fixture(body){
 const runDir=await mkdtemp(join(tmpdir(),'appserver-'));
 const executable=join(runDir,'codex-fixture.mjs');
 await writeFile(executable,`#!${process.execPath}\nimport readline from 'node:readline';\nconst send=value=>process.stdout.write(JSON.stringify(value)+'\\n');\nfor await(const line of readline.createInterface({input:process.stdin})){const request=JSON.parse(line);if(!request.id)continue;${body}}`);await chmod(executable,0o700);
 return {runDir,executable,hostContext:{providers:{codex:{transport:'app-server'}}}};
}
const initialize=`if(request.method==='initialize')send({id:request.id,result:{}});else if(request.method==='thread/start')send({id:request.id,result:{thread:{id:'thread-1'}}});`;
test('app-server transport returns native agent text and usage',async()=>{
 const context=await fixture(initialize+`else if(request.method==='turn/start'){send({id:request.id,result:{turn:{id:'turn-1'}}});send({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'answer',type:'agentMessage',text:'native answer'}}});send({method:'thread/tokenUsage/updated',params:{threadId:'thread-1',turnId:'turn-1',tokenUsage:{last:{inputTokens:11,cachedInputTokens:3,outputTokens:7}}}});send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed',durationMs:12,error:null}}});}`);
 try{const result=await codexAgent('hello',{},context);assert.equal(result.result,'native answer');assert.equal(result.outputTokens,7);}finally{await rm(context.runDir,{recursive:true,force:true});}
});

test('native terminal error codes survive the public adapter without message inference',async()=>{
 const context=await fixture(initialize+`else if(request.method==='turn/start'){send({id:request.id,result:{turn:{id:'turn-1'}}});const error={message:'opaque provider failure',codexErrorInfo:'unauthorized'};send({method:'error',params:{threadId:'thread-1',turnId:'turn-1',error,willRetry:false}});send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'failed',error}}});}`);
 try{await assert.rejects(codexAgent('hello',{},context),error=>error.kind==='terminal-api'&&error.codexErrorInfo==='unauthorized'&&error.message==='opaque provider failure');}finally{await rm(context.runDir,{recursive:true,force:true});}
});

test('cancellation interrupts and closes the native app-server before rejecting',async()=>{
 const context=await fixture(initialize+`else if(request.method==='turn/start'){send({id:request.id,result:{turn:{id:'turn-1'}}});send({method:'item/started',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'answer',type:'agentMessage',text:''}}});}else if(request.method==='turn/interrupt')send({id:request.id,result:{}});`);
 const controller=new AbortController();let timeout;
 try{
  const pending=codexAgent('hello',{}, {...context,signal:controller.signal,onResponse:()=>controller.abort(Error('cancel native'))});pending.catch(()=>{});
  await assert.rejects(Promise.race([pending,new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('native cancellation did not settle')),1000))]),/cancel native/);
 }finally{clearTimeout(timeout);controller.abort();await rm(context.runDir,{recursive:true,force:true});}
});

test('server request IDs do not collide with pending client request IDs',async()=>{
 const context=await fixture(`if(request.method==='initialize')send({id:request.id,result:{}});else if(request.method==='thread/start'){send({id:request.id,method:'account/chatgptAuthTokens/refresh',params:{}});setTimeout(()=>send({id:request.id,result:{thread:{id:'thread-1'}}}),10);}else if(request.method==='turn/start'){send({id:request.id,result:{turn:{id:'turn-1'}}});send({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'answer',type:'agentMessage',text:'safe'}}});send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});}`);
 try{assert.equal((await codexAgent('hello',{},context)).result,'safe');}finally{await rm(context.runDir,{recursive:true,force:true});}
});

test('a native terminal stream disconnect retains its typed lost-reply cause and usage',async()=>{
 const context=await fixture(initialize+`else if(request.method==='turn/start'){send({id:request.id,result:{turn:{id:'turn-1'}}});send({method:'thread/tokenUsage/updated',params:{threadId:'thread-1',turnId:'turn-1',tokenUsage:{last:{inputTokens:4,cachedInputTokens:1,outputTokens:2}}}});send({method:'error',params:{threadId:'thread-1',turnId:'turn-1',willRetry:true,error:{message:'temporary',codexErrorInfo:{responseStreamDisconnected:{httpStatusCode:502}}}}});send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'failed',error:{message:'opaque',codexErrorInfo:{responseStreamDisconnected:{httpStatusCode:502}}}}}});}`);
 let usage;
 try{await assert.rejects(codexAgent('hello',{}, {...context,onUsage:value=>usage=value}),error=>error.kind==='lost-reply'&&error.codexErrorInfo.responseStreamDisconnected.httpStatusCode===502);assert.equal(usage.outputTokens,2);}finally{await rm(context.runDir,{recursive:true,force:true});}
});

test('native quota failures carry the authoritative usage snapshot without inferring recovery',async()=>{
 const context=await fixture(initialize+`else if(request.method==='turn/start'){send({id:request.id,result:{turn:{id:'turn-1'}}});send({method:'account/rateLimits/updated',params:{rateLimits:{primary:{usedPercent:0,resetsAt:1}}}});send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'failed',error:{message:'opaque quota',codexErrorInfo:'usageLimitExceeded'}}}});}else if(request.method==='account/rateLimits/read')send({id:request.id,result:{ordinaryUsageAllowed:false,rateLimits:{primary:{usedPercent:0,resetsAt:1}}}});`);
 try{await assert.rejects(codexAgent('hello',{},context),error=>error.kind==='rate-limit'&&error.rateLimit.ordinaryUsageAllowed===false&&error.rateLimit.rateLimits.primary.resetsAt===1);}finally{await rm(context.runDir,{recursive:true,force:true});}
});

for(const detached of [false,true])test(`cancellation stops a ${detached?'detached':'same-group'} native descendant that ignores SIGTERM`,async()=>{
 const context=await fixture(initialize+`else if(request.method==='turn/start'){const fs=await import('node:fs');const path=new URL('./heartbeat',import.meta.url).pathname;const code="const fs=require('fs');process.on('SIGTERM',()=>{});let i=0;setInterval(()=>fs.writeFileSync(process.argv[1],String(++i)),5);";const child=(await import('node:child_process')).spawn(process.execPath,['-e',code,path],{stdio:'ignore',detached:${detached}});fs.writeFileSync(new URL('./descendant',import.meta.url),String(child.pid));send({id:request.id,result:{turn:{id:'turn-1'}}});send({method:'item/started',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'answer',type:'agentMessage',text:''}}});}else if(request.method==='turn/interrupt')send({id:request.id,result:{}});`);
 const controller=new AbortController();let descendant,pending;
 try{
  pending=codexAgent('hello',{}, {...context,signal:controller.signal,onResponse:()=>{}});pending.catch(()=>{});
  const deadline=performance.now()+2000;
  while(true){try{await readFile(join(context.runDir,'heartbeat'));break;}catch{if(performance.now()>deadline)throw Error('descendant did not start');await new Promise(r=>setTimeout(r,5));}}
  descendant=Number(await readFile(join(context.runDir,'descendant'),'utf8'));controller.abort(Error('cancel descendant'));
  await assert.rejects(pending,/cancel descendant/);
  const before=await readFile(join(context.runDir,'heartbeat'),'utf8');await new Promise(r=>setTimeout(r,40));assert.equal(await readFile(join(context.runDir,'heartbeat'),'utf8'),before,'descendant must not continue writing after cancellation acknowledges');
 }finally{controller.abort();if(descendant)try{process.kill(descendant,'SIGKILL');}catch{}await pending?.catch(()=>{});await rm(context.runDir,{recursive:true,force:true});}
});

test('native other errors decode an exact structured API envelope without matching English',async()=>{
 const envelope={type:'error',status:400,error:{type:'invalid_request_error',message:'opaque provider refusal',code:'model_not_found'}};
 const context=await fixture(initialize+`else if(request.method==='turn/start'){send({id:request.id,result:{turn:{id:'turn-1'}}});send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'failed',error:{message:${JSON.stringify(JSON.stringify(envelope))},codexErrorInfo:'other'}}}});}`);
 try{await assert.rejects(codexAgent('hello',{},context),error=>error.kind==='terminal-api'&&error.apiError.code==='model_not_found'&&error.httpStatusCode===400);}finally{await rm(context.runDir,{recursive:true,force:true});}
});

test('native notification buffering rejects an aggregate byte budget overflow',async()=>{
 const context=await fixture(`if(request.method==='initialize'){for(let i=0;i<18;i++)send({method:'test/noise',params:{payload:'x'.repeat(1024*1024)}});send({id:request.id,result:{}});}else if(request.method==='thread/start')send({id:request.id,result:{thread:{id:'thread-1'}}});else if(request.method==='turn/start'){send({id:request.id,result:{turn:{id:'turn-1'}}});send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});}`);
 try{await assert.rejects(codexAgent('hello',{},context),/notification.*byte|queue.*exceeded/i);}finally{await rm(context.runDir,{recursive:true,force:true});}
});

test('native schema repairs keep their thread, home, MCP configuration and cumulative usage',async()=>{
 const context=await fixture(initialize+`else if(request.method==='turn/start'){if(!process.env.CODEX_HOME||!process.argv.some(value=>value.includes('mcp_servers'))||!request.params.outputSchema)throw Error('native context missing');globalThis.turns=(globalThis.turns??0)+1;send({id:request.id,result:{turn:{id:'turn-'+globalThis.turns}}});const turnId='turn-'+globalThis.turns;send({method:'item/completed',params:{threadId:'thread-1',turnId,item:{id:'answer',type:'agentMessage',text:JSON.stringify({count:globalThis.turns===1?'invalid':7})}}});send({method:'thread/tokenUsage/updated',params:{threadId:'thread-1',turnId,tokenUsage:{last:{inputTokens:4,cachedInputTokens:1,outputTokens:2}}}});send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:turnId,status:'completed'}}});}`);
 context.hostContext.providers.codex.codexHome=context.runDir;context.hostContext.providers.codex.mcpServers={test:{command:'/bin/false'}};
 try{const result=await codexAgent('hello',{schema:{type:'object',properties:{count:{type:'integer'}},required:['count'],additionalProperties:false}},context);assert.deepEqual(result.result,{count:7});assert.equal(result.outputTokens,4);}finally{await rm(context.runDir,{recursive:true,force:true});}
});

test('native retry notifications and unrelated turns cannot override successful completion',async()=>{
 const context=await fixture(initialize+`else if(request.method==='turn/start'){send({id:request.id,result:{turn:{id:'turn-1'}}});send({method:'error',params:{threadId:'thread-1',turnId:'turn-1',willRetry:true,error:{message:'retrying',codexErrorInfo:'usageLimitExceeded'}}});send({method:'turn/completed',params:{threadId:'other-thread',turn:{id:'turn-1',status:'failed',error:{message:'other',codexErrorInfo:'unauthorized'}}}});send({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'answer',type:'agentMessage',text:'success'}}});send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});}`);
 try{assert.equal((await codexAgent('hello',{},context)).result,'success');}finally{await rm(context.runDir,{recursive:true,force:true});}
});

test('native threads explicitly receive trusted MCP and feature configuration',async()=>{
 const context=await fixture(`if(request.method==='initialize')send({id:request.id,result:{}});else if(request.method==='thread/start'){globalThis.configured=request.params.config?.features?.shell_tool===false&&request.params.config?.features?.multi_agent===false&&!!request.params.config?.mcp_servers?.parity&&request.params.developerInstructions?.includes('trusted-marker');send({id:request.id,result:{thread:{id:'thread-1'}}});}else if(request.method==='turn/start'){send({id:request.id,result:{turn:{id:'turn-1'}}});send({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'answer',type:'agentMessage',text:globalThis.configured?'configured':'missing'}}});send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});}`);
 context.hostContext.instructions='trusted-marker';context.hostContext.providers.codex.mcpServers={parity:{command:'/bin/false'}};
 try{assert.equal((await codexAgent('hello',{disallowedTools:['Bash']},context)).result,'configured');}finally{await rm(context.runDir,{recursive:true,force:true});}
});

test('native finalized API overload and connection failures retain different failure kinds',async()=>{
 for(const [code,kind] of [['serverOverloaded','transient-api'],[{httpConnectionFailed:{httpStatusCode:null}},undefined]]){
  const context=await fixture(initialize+`else if(request.method==='turn/start'){send({id:request.id,result:{turn:{id:'turn-1'}}});send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'failed',error:{message:'opaque failure',codexErrorInfo:${JSON.stringify(code)}}}}});}`);
  try{await assert.rejects(codexAgent('hello',{},context),error=>error.kind===kind);}finally{await rm(context.runDir,{recursive:true,force:true});}
 }
});

test('native startup sends CLI overrides using supported dotted key syntax',async()=>{
 const context=await fixture(initialize+`else if(request.method==='turn/start'){send({id:request.id,result:{turn:{id:'turn-1'}}});send({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{id:'answer',type:'agentMessage',text:process.argv.includes('features.shell_tool=false')&&process.argv.includes('features.multi_agent=false')?'configured':'missing'}}});send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed'}}});}`);
 try{assert.equal((await codexAgent('hello',{disallowedTools:['Bash']},context)).result,'configured');}finally{await rm(context.runDir,{recursive:true,force:true});}
});

test('typed API envelopes accept nullable or absent API error codes without parsing prose',async()=>{
 for(const apiError of [{type:'server_error',code:null,message:'opaque'},{type:'server_error',message:'opaque'}]){
  const envelope={type:'error',status:500,error:apiError};
  const context=await fixture(initialize+`else if(request.method==='turn/start'){send({id:request.id,result:{turn:{id:'turn-1'}}});send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'failed',error:{message:${JSON.stringify(JSON.stringify(envelope))},codexErrorInfo:'other'}}}});}`);
  try{await assert.rejects(codexAgent('hello',{},context),error=>error.kind==='api-error'&&error.httpStatusCode===500&&error.apiError.type==='server_error');}finally{await rm(context.runDir,{recursive:true,force:true});}
 }
});
