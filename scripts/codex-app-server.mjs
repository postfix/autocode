import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {safeText} from './run-stats.mjs';

// Match the pinned @openai/codex-sdk native package layout; never search PATH.
function executablePath(override){
 if(override)return override;
 const require=createRequire(import.meta.url),arch={x64:'x86_64',arm64:'aarch64'}[process.arch];
 const target={linux:'unknown-linux-musl',android:'unknown-linux-musl',darwin:'apple-darwin',win32:'pc-windows-msvc'}[process.platform];
 if(!arch||!target)throw Error('Unsupported Codex native platform');
 const cli=require.resolve('@openai/codex/package.json');const cliRequire=createRequire(cli);
 const platform=process.platform==='android'?'linux':process.platform;
 const root=join(dirname(cliRequire.resolve(`@openai/codex-${platform}-${process.arch}/package.json`)),'vendor',`${arch}-${target}`);
 const name=process.platform==='win32'?'codex.exe':'codex';
 for(const path of [join(root,'bin',name),join(root,'codex',name)])if(existsSync(path))return path;
 throw Error('Unable to locate installed Codex native executable');
}
function toml(value){
 if(typeof value==='string')return JSON.stringify(value);
 if(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return String(value);
 if(Array.isArray(value))return `[${value.map(toml).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>`${JSON.stringify(k)}=${toml(v)}`).join(',')}}`;
 throw TypeError('Unsupported app-server configuration value');
}
function configArgs(config,prefix=''){
 return Object.entries(config??{}).flatMap(([key,value])=>{
  if(value===undefined)return [];
  const segment=/^[A-Za-z0-9_-]+$/.test(key)?key:JSON.stringify(key);
  const path=prefix?`${prefix}.${segment}`:segment;
  return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length?configArgs(value,path):['-c',`${path}=${toml(value)}`];
 });
}
async function processIdentity(pid){
 try{const value=await readFile(`/proc/${pid}/stat`,'utf8'),fields=value.slice(value.lastIndexOf(')')+2).split(' ');return {pid,state:fields[0],start:fields[19]};}catch(error){if(['ENOENT','ESRCH'].includes(error.code))return null;throw error;}
}
async function descendants(pid){
 const self=await processIdentity(pid);if(!self)return [];
 let children='';try{children=await readFile(`/proc/${pid}/task/${pid}/children`,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 return [self,...(await Promise.all(children.trim().split(/\s+/).filter(Boolean).map(descendants))).flat()];
}
async function alive(identity){const current=await processIdentity(identity.pid);return current&&current.start===identity.start&&!['Z','X'].includes(current.state);}
class Connection{
 constructor(options){
  this.requests=new Map();this.events=[];this.nextId=1;this.buffer='';this.queuedBytes=0;this.waiter=null;this.failure=null;
  this.child=spawn(executablePath(options.codexPathOverride),['app-server','--listen','stdio://',...configArgs(options.config)],{env:options.env??process.env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
  this.exited=new Promise(resolve=>this.child.once('close',resolve));
  this.child.stderr.resume(); // Native diagnostics may contain private request context.
  this.child.on('error',error=>this.fail(error));
  this.child.on('close',()=>this.fail(Error('Codex app-server connection closed')));
  this.child.stdin.on('error',error=>this.fail(error));
  this.child.stdout.setEncoding('utf8');
  this.child.stdout.on('data',chunk=>{
   this.buffer+=chunk;
   if(Buffer.byteLength(this.buffer)>8*1024*1024){this.fail(Error('Codex app-server frame exceeds 8 MiB'));this.child.kill();return;}
   for(let end;(end=this.buffer.indexOf('\n'))>=0;){
    const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);if(!line.trim())continue;
    let message;try{message=JSON.parse(line);}catch{this.fail(Error('Invalid Codex app-server JSON frame'));this.child.kill();return;}
    if(message.method&&message.id!==undefined){
     this.send({id:message.id,error:{code:-32601,message:'Client request unsupported'}});
    }else if(message.id!==undefined&&this.requests.has(message.id)){
     const pending=this.requests.get(message.id);this.requests.delete(message.id);clearTimeout(pending.timer);
     if(message.error)pending.reject(Error(`Codex app-server RPC error (${message.error.code})`));else pending.resolve(message.result);
    }else if(message.method){const bytes=Buffer.byteLength(line);if(this.events.length>=4096||this.queuedBytes+bytes>16*1024*1024){this.fail(Error('Codex app-server notification byte queue exceeded'));this.child.kill();return;}this.queuedBytes+=bytes;this.events.push({message,bytes});this.wake();}
   }
  });
 }
 send(value){this.child.stdin.write(JSON.stringify(value)+'\n');}
 request(method,params){
  if(this.failure)return Promise.reject(this.failure);
  const id=this.nextId++;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.requests.delete(id);reject(Error(`Codex app-server request timed out: ${method}`));},30000);this.requests.set(id,{resolve,reject,timer});this.send({id,method,params});});
 }
 wake(){this.waiter?.();this.waiter=null;}
 fail(error){if(this.failure)return;this.failure=error;for(const request of this.requests.values()){clearTimeout(request.timer);request.reject(error);}this.requests.clear();this.wake();}
 async next(){while(!this.events.length){if(this.failure)throw this.failure;await new Promise(resolve=>this.waiter=resolve);}const event=this.events.shift();this.queuedBytes-=event.bytes;return event.message;}
 close(){
  if(this.closing)return this.closing;
  this.closing=(async()=>{
   const owned=process.platform==='linux'&&this.child.pid?await descendants(this.child.pid):[];
   this.fail(Error('Codex app-server closed'));this.child.stdin.end();
   const kill=signal=>{try{if(process.platform!=='win32'&&this.child.pid)process.kill(-this.child.pid,signal);else this.child.kill(signal);}catch(error){if(error.code!=='ESRCH')throw error;}};
   kill('SIGTERM');let force,deadline;
   try{await Promise.race([this.exited,new Promise((_,reject)=>{force=setTimeout(()=>kill('SIGKILL'),200);deadline=setTimeout(()=>{const error=Error('Native cancellation could not be confirmed');error.code='cancellation-unconfirmed';reject(error);},750);})]);}
   finally{clearTimeout(force);clearTimeout(deadline);}
   kill('SIGKILL');
   for(const identity of owned)if(await alive(identity))try{process.kill(identity.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
   const end=performance.now()+300;
   while((await Promise.all(owned.map(alive))).some(Boolean)){
    if(performance.now()>end){const error=Error('Native descendants did not stop');error.code='cancellation-unconfirmed';throw error;}
    await new Promise(resolve=>setTimeout(resolve,5));
   }
  })();return this.closing;
 }
}
function itemValue(item){
 const type={agentMessage:'agent_message',reasoning:'reasoning',commandExecution:'command_execution',mcpToolCall:'mcp_tool_call',fileChange:'file_change',webSearch:'web_search'}[item.type];
 return type?{...item,type,...(item.type==='commandExecution'?{command:item.command,exit_code:item.exitCode,aggregated_output:item.aggregatedOutput,status:item.status}: {})}:null;
}
export class AppServerCodex{
 constructor(options={}){this.options=options;}
 startThread(options={}){return new AppServerThread(this.options,options);}
}
export function normalizeFailure(error={}){
 const code=error.codexErrorInfo;
 const terminal=['contextWindowExceeded','sessionBudgetExceeded','unauthorized','badRequest','cyberPolicy','misalignmentPolicyViolation','tooManyDenials'];
 const variant=code&&typeof code==='object'?Object.entries(code)[0]:undefined;
 let apiEnvelope;
 if((code==='other'||code===undefined)&&typeof error.message==='string')try{
  const value=JSON.parse(error.message);
  if(value?.type==='error'&&Number.isInteger(value.status)&&value.status>=400&&value.status<=599&&typeof value.error?.type==='string'&&(value.error.code==null||typeof value.error.code==='string'))apiEnvelope=value;
 }catch{}
 const status=variant?.[1]?.httpStatusCode??apiEnvelope?.status;
 const kind=[401,403].includes(status)||terminal.includes(code)||apiEnvelope&&['model_not_found','invalid_request_error'].includes(apiEnvelope.error.code)?'terminal-api':status===429||['usageLimitExceeded','rateLimitExceeded'].includes(code)?'rate-limit':variant?.[0]==='responseStreamDisconnected'?'lost-reply':['serverOverloaded','internalServerError','flexUnavailable'].includes(code)?'transient-api':apiEnvelope||Number.isInteger(status)&&status>=400&&status<=599?'api-error':undefined;
 return Object.assign(Error(safeText(error.message??'Codex app-server turn failed')), {codexErrorInfo:code,...(apiEnvelope?{httpStatusCode:status,apiError:{type:apiEnvelope.error.type,code:apiEnvelope.error.code}}:{}),...(kind?{kind}:{})});
}
class AppServerThread{
 constructor(clientOptions,options){this.clientOptions=clientOptions;this.options=options;}
 async initialize(){
  if(this.connection)return;
  this.connection=new Connection(this.clientOptions);
  await this.connection.request('initialize',{clientInfo:{name:'autocode',version:'0.1.1'},capabilities:{experimentalApi:true}});
  this.connection.send({method:'initialized',params:{}});
  const result=await this.connection.request('thread/start',{cwd:this.options.workingDirectory,model:this.options.model,sandbox:this.options.sandboxMode,approvalPolicy:'never',ephemeral:true,config:this.clientOptions.config,developerInstructions:this.clientOptions.config?.developer_instructions});
  this.id=result.thread.id;
 }
 async close(){await this.connection?.close();}
 async runStreamed(prompt,options={}){return {events:this.events(prompt,options)};}
 async run(prompt,options={}){
  let finalResponse='',usage;const items=[];
  for await(const event of this.events(prompt,options)){
   if(event.type==='turn.failed')throw Object.assign(Error(event.error.message),event.error);
   if(event.type==='item.completed'){items.push(event.item);if(event.item.type==='agent_message')finalResponse=event.item.text;}
   if(event.type==='turn.completed')usage=event.usage;
  }
  return {items,finalResponse,usage};
 }
 async *events(prompt,options){
  let interrupt;
  const abort=()=>{
   interrupt=(async()=>{
    if(this.turnId){let timer;try{await Promise.race([this.connection.request('turn/interrupt',{threadId:this.id,turnId:this.turnId}),new Promise(resolve=>timer=setTimeout(resolve,100))]);}catch{}finally{clearTimeout(timer);}}
    await this.close();
   })();interrupt.catch(()=>{});
  };
  options.signal?.addEventListener('abort',abort,{once:true});
  try{
   options.signal?.throwIfAborted();await this.initialize();
   const started=await this.connection.request('turn/start',{threadId:this.id,input:[{type:'text',text:prompt,text_elements:[]}],model:this.options.model,effort:this.options.modelReasoningEffort,outputSchema:options.outputSchema});
   const turnId=started.turn.id;this.turnId=turnId;
   options.signal?.throwIfAborted();
   let usage,lastError;
   for(;;){
    const event=await this.connection.next(),params=event.params??{};
    if(params.threadId!==this.id)continue;
    if(params.turnId&&params.turnId!==turnId)continue;
    if(event.method==='error'&&params.willRetry===false)lastError=params.error;
    if(event.method==='thread/tokenUsage/updated'){
     const last=params.tokenUsage.last;usage={input_tokens:last.inputTokens,cached_input_tokens:last.cachedInputTokens,output_tokens:last.outputTokens};
    }
    if(['item/started','item/completed'].includes(event.method)){
     const item=itemValue(params.item);if(item)yield {type:event.method==='item/started'?'item.started':'item.completed',item};
    }
    if(event.method==='turn/completed'&&params.turn.id===turnId){
     if(params.turn.status!=='completed'){
      const error=Object.assign(normalizeFailure(params.turn.error??lastError),{usage});
      if(error.kind==='rate-limit')try{error.rateLimit=await this.connection.request('account/rateLimits/read',{});}catch{error.rateLimit=null;}
      throw error;
     }
     yield {type:'turn.completed',usage};return;
    }
   }
  }catch(error){if(interrupt)await interrupt;else await this.close();throw options.signal?.aborted?options.signal.reason:error;}finally{options.signal?.removeEventListener('abort',abort);this.turnId=undefined;}
 }
}
