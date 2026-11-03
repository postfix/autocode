import {Codex} from '@openai/codex-sdk';
import {query} from '@anthropic-ai/claude-agent-sdk';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {homedir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {runWorkflow} from '../scripts/runtime.mjs';
import {codexAgent} from '../scripts/codex-adapter.mjs';
import {claudeAgent} from '../scripts/claude-adapter.mjs';
import {safeText} from '../scripts/run-stats.mjs';
import {createReviewContextFixture,snapshotReviewContext,retireReviewContextEvidence,scoreReviewContext,reviewContextCommandReceipt,reviewContextToolReceipt,REVIEW_CONTEXT_STAGES} from './review-context-fixture.mjs';

export const REVIEW_CONTEXT_MODELS={codex:'gpt-6-luna',claude:'claude-haiku-5-5'};
async function codexModelEvidence(home,ids){
 const observed=[];
 async function visit(directory){
  for(const entry of await readdir(directory,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;})){
   const file=join(directory,entry.name);
   if(entry.isDirectory())await visit(file);
   else if(entry.name.endsWith('.jsonl')&&ids.some(id=>entry.name.includes(id))){
    for await(const line of createInterface({input:createReadStream(file),crlfDelay:Infinity}))try{
     const event=JSON.parse(line);
     if(event.type==='turn_context'&&typeof event.payload?.model==='string')observed.push({source:'Codex session turn_context',session:file,model:event.payload.model});
    }catch{}
   }
  }
 }
 await visit(join(home,'sessions'));return observed;
}
export async function runReviewContextLive({provider,root=resolve('.scratch/review-context-live'),model=REVIEW_CONTEXT_MODELS[provider],timeoutMs=600000,codexHome}={}){
 if(!['codex','claude'].includes(provider))throw TypeError('provider must be codex or claude');
 if(typeof model!=='string'||!(provider==='codex'?/^gpt-/:/^claude-/).test(model))throw TypeError('an exact provider model ID is required; aliases are not accepted');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw TypeError('timeoutMs must be a positive integer');
 const attempt=join(resolve(root),`${new Date().toISOString().replace(/[:.]/g,'-')}-${provider}-${randomUUID().slice(0,8)}`);
 await mkdir(attempt,{recursive:true,mode:0o700});
 const fixture=await createReviewContextFixture(join(attempt,'project'));
 await writeFile(join(attempt,'fixture-oracle.json'),JSON.stringify(fixture,null,2),{mode:0o600});
 const template=new URL('../assets/templates/review-fix-loop.js',import.meta.url);
 const script=await readFile(template,'utf8');
 const calls=[],observed=[],threadIds=[];
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(Error('Matched context evaluation timed out')),timeoutMs);
 function tracedCodex(call){return class extends Codex {
  startThread(options){
   const thread=super.startThread(options),runStreamed=thread.runStreamed.bind(thread);
   thread.runStreamed=async(...args)=>{
    const stream=await runStreamed(...args);
    return {events:(async function*(){for await(const event of stream.events){
     if(event.type==='thread.started'&&typeof event.thread_id==='string'){threadIds.push(event.thread_id);(call.threadIds??=[]).push(event.thread_id);}
     if(event.type==='item.completed'&&['command_execution','commandExecution','CommandExecution'].includes(event.item?.type)){
      const item=event.item,receipt=reviewContextCommandReceipt(fixture,{command:item.command,output:item.aggregated_output??item.aggregatedOutput,exitCode:item.exit_code??item.exitCode,id:item.id});
      if(receipt.reportPathMatch)call.toolReceipts.push(receipt);
     }
     yield event;
    }})()};
   };
   return thread;
  }
 };}
 let result,error;
 try{
  result=await runWorkflow({script,cwd:fixture.project,runDir:join(attempt,'run'),signal:controller.signal,defaultProvider:provider,
   args:{packet:fixture.packetPath,reportRoot:fixture.reportsDir,maxRounds:2},
   hostContext:{id:`review-context-${provider}`,revision:randomUUID(),providers:{[provider]:{model,forcedModel:model,...(provider==='codex'&&codexHome?{codexHome}:{})}}},
   agent:async(prompt,options,context)=>{
    const call={label:options.label,phase:options.phase,prompt,requestedModel:options.model,before:await snapshotReviewContext(fixture.project),startedAt:new Date().toISOString(),activity:[],toolReceipts:[]};
    const pendingTools=new Map();
    calls.push(call);
    try{
     const response=await (provider==='codex'?codexAgent:claudeAgent)(prompt,{...options,model,sandbox:'workspace-write'},{...context,
      ...(provider==='codex'?{Codex:tracedCodex(call)}: {query:request=>{
       const stream=query(request);
       return (async function*(){try{for await(const message of stream){
        const reported=message.type==='system'&&message.subtype==='init'?message.model:message.type==='assistant'?message.message?.model:undefined;
        if(typeof reported==='string'&&reported!=='<synthetic>')observed.push({source:message.type==='assistant'?'Claude assistant':'Claude system/init',model:reported,label:call.label});
        for(const block of Array.isArray(message.message?.content)?message.message.content:[]){
         if(block.type==='tool_use'&&['Read','Bash','Grep'].includes(block.name))pendingTools.set(block.id,{tool:block.name,input:block.input});
         if(block.type==='tool_result'&&pendingTools.has(block.tool_use_id)){
          const use=pendingTools.get(block.tool_use_id);pendingTools.delete(block.tool_use_id);
          const receipt=reviewContextToolReceipt(fixture,{...use,output:block.content,isError:block.is_error,id:block.tool_use_id});
          if(receipt.reportPathMatch&&!call.toolReceipts.some(previous=>previous.id===receipt.id))call.toolReceipts.push(receipt);
         }
        }
        yield message;
       }}finally{await stream.close?.();}})();
      }}),
      onActivity:event=>{call.activity.push(event);context.onActivity?.(event);},
     });
     call.result=response.result;call.outputTokens=response.outputTokens;
     call.after=await snapshotReviewContext(fixture.project);
     const stage=REVIEW_CONTEXT_STAGES.find(([label])=>label===call.label);
     if(stage)call.report=await readFile(join(fixture.reportsDir,stage[2]),'utf8').catch(()=>null);
     if(call.label==='R1 Red Team'){await retireReviewContextEvidence(fixture,response.result);call.evidenceRetired=true;}
     return response;
    }catch(failure){call.error={message:safeText(failure.message),kind:failure.kind??null};throw failure;}
    finally{
     call.after??=await snapshotReviewContext(fixture.project);call.endedAt=new Date().toISOString();
     await writeFile(join(attempt,'calls.json'),JSON.stringify(calls,null,2),{mode:0o600});
    }
   },
  });
 }catch(failure){error={message:safeText(failure.message),kind:failure.kind??null};}
 finally{clearTimeout(timer);}
 if(provider==='codex')try{observed.push(...await codexModelEvidence(codexHome??process.env.CODEX_HOME??join(homedir(),'.codex'),[...new Set(threadIds)]));}catch(failure){observed.push({source:'model evidence lookup error',error:safeText(failure.message)});}
 const score=await scoreReviewContext({fixture,result,calls});
 const observedModels=[...new Set(observed.map(item=>item.model).filter(Boolean))];
 const modelVerified=observedModels.length>0&&observedModels.every(value=>value===model);
 const implementationHashes=Object.fromEntries(await Promise.all(['scripts/runtime.mjs','scripts/codex-adapter.mjs','scripts/claude-adapter.mjs','assets/templates/review-fix-loop.js','evals/review-context-fixture.mjs'].map(async file=>[file,createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex')])));
 const evidence={scope:'Matched delegated review/fix context retrieval and closure; not full SF specification quality, native fork or parent UI wake-up.',provider,requestedModel:model,observedModels,observedModelEvidence:observed,modelVerified,attempt,templateSha256:createHash('sha256').update(script).digest('hex'),implementationHashes,result,error,score,calls,passed:!error&&score.passed&&modelVerified};
 await writeFile(join(attempt,'result.json'),JSON.stringify(evidence,null,2),{mode:0o600});
 return evidence;
}
export async function regradeReviewContextReceipts(attempt){
 attempt=resolve(attempt);
 const originalPath=join(attempt,'result.json'),originalBytes=await readFile(originalPath);
 const original=JSON.parse(originalBytes),fixture=JSON.parse(await readFile(join(attempt,'fixture-oracle.json'),'utf8'));
 const calls=structuredClone(original.calls),target=calls.find(call=>call.label==='R2 Red Team');
 if(!target)throw Error('Original attempt has no R2 Red Team call');
 target.toolReceipts=[];
 const nativeEvidence=[];
 const text=content=>typeof content==='string'?content:Array.isArray(content)?content.map(block=>block.text??'').join('\n'):'';
 const readSession=async path=>{
  const bytes=await readFile(path),events=bytes.toString('utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));
  return {events,sha256:createHash('sha256').update(bytes).digest('hex')};
 };
 if(original.provider==='codex'){
  for(const path of [...new Set(original.observedModelEvidence.map(item=>item.session).filter(Boolean))]){
   const {events,sha256}=await readSession(path);
   if(!events.some(event=>event.type==='response_item'&&event.payload?.role==='user'&&text(event.payload.content).includes(target.prompt)))continue;
   nativeEvidence.push({path,sha256});
   for(const event of events)if(event.type==='event_msg'&&event.payload?.type==='item_completed'&&event.payload.item?.type==='CommandExecution'){
    const item=event.payload.item,receipt=reviewContextCommandReceipt(fixture,{command:item.command,output:item.aggregated_output,exitCode:item.exit_code,id:item.id,source:'Codex persisted item_completed'});
    if(receipt.reportPathMatch)target.toolReceipts.push({...receipt,session:path,recordOrdinal:event.ordinal??null});
   }
  }
 }else if(original.provider==='claude'){
  const directory=join(process.env.CLAUDE_CONFIG_DIR??join(homedir(),'.claude'),'projects',fixture.project.replace(/[^a-zA-Z0-9]/g,'-'));
  for(const entry of await readdir(directory,{withFileTypes:true})){
   if(!entry.isFile()||!entry.name.endsWith('.jsonl'))continue;
   const path=join(directory,entry.name),{events,sha256}=await readSession(path);
   if(!events.some(event=>event.type==='user'&&text(event.message?.content).includes(target.prompt)))continue;
   nativeEvidence.push({path,sha256});
   const pending=new Map(),seen=new Set();
   for(const event of events)for(const block of Array.isArray(event.message?.content)?event.message.content:[]){
    if(block.type==='tool_use'&&['Read','Bash','Grep'].includes(block.name))pending.set(block.id,{tool:block.name,input:block.input});
    if(block.type==='tool_result'&&pending.has(block.tool_use_id)&&!seen.has(block.tool_use_id)){
     seen.add(block.tool_use_id);
     const receipt=reviewContextToolReceipt(fixture,{...pending.get(block.tool_use_id),output:block.content,isError:block.is_error,id:block.tool_use_id,source:'Claude persisted tool_result'});
     if(receipt.reportPathMatch)target.toolReceipts.push({...receipt,session:path,recordUuid:event.uuid??null});
    }
   }
  }
 }else throw Error('Unsupported original provider');
 const score=await scoreReviewContext({fixture,result:original.result,calls});
 const regradeImplementationHashes=Object.fromEntries(await Promise.all(['evals/review-context-fixture.mjs','evals/review-context-live.mjs'].map(async file=>[file,createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex')])));
 const evidence={originalResult:originalPath,originalSha256:createHash('sha256').update(originalBytes).digest('hex'),originalImplementationHashes:original.implementationHashes,regradeImplementationHashes,nativeEvidence,toolReceipts:target.toolReceipts,score,observedModels:original.observedModels,modelVerified:original.modelVerified,passed:!original.error&&score.passed&&original.modelVerified};
 const resultFile=join(attempt,'regraded-tool-receipts.json');
 await writeFile(resultFile,JSON.stringify(evidence,null,2),{mode:0o600,flag:'wx'});
 return {...evidence,resultFile};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2),flags={};
 for(let index=0;index<args.length;index+=2){if(!args[index].startsWith('--')||args[index+1]===undefined)throw Error('Expected --provider codex|claude [--root path] [--model exact-id] [--timeout-ms number] [--codex-home path]');flags[args[index].slice(2)]=args[index+1];}
 const evidence=flags.regrade?await regradeReviewContextReceipts(flags.regrade):await runReviewContextLive({provider:flags.provider,root:flags.root,model:flags.model,timeoutMs:flags['timeout-ms']===undefined?undefined:Number(flags['timeout-ms']),codexHome:flags['codex-home']});
 console.log(JSON.stringify({passed:evidence.passed,provider:evidence.provider,requestedModel:evidence.requestedModel,observedModels:evidence.observedModels,modelVerified:evidence.modelVerified,score:evidence.score,resultFile:evidence.resultFile??join(evidence.attempt,'result.json'),error:evidence.error}));
 if(!evidence.passed)process.exitCode=1;
}
