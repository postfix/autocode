import {query} from '@anthropic-ai/claude-agent-sdk';
import {mkdir,mkdtemp,readFile,writeFile,symlink,unlink,access} from 'node:fs/promises';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {FULL_TASK,FULL_TASK_REPORT_SCHEMA,createFullTaskFixture,scoreFullTask} from './full-task-fixture.mjs';
import {safeText} from '../scripts/run-stats.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const scratch=join(root,'.scratch/full-task-claude');await mkdir(scratch,{recursive:true});
const attempt=await mkdtemp(join(scratch,'attempt-')),project=join(attempt,'project'),state=join(attempt,'sdk-state');
await mkdir(state,{mode:0o700});
const authSource=join(process.env.CLAUDE_CONFIG_DIR??join(homedir(),'.claude'),'.credentials.json');
const authLink=join(state,'.credentials.json');let linked=false;
const env={...process.env,CLAUDE_CONFIG_DIR:state};
const canonicalModel='claude-haiku-5-5';
const within=(base,path)=>{const part=relative(base,resolve(path));return part===''||(!part.startsWith('..')&&!isAbsolute(part));};
const shell=value=>"'"+value.replaceAll("'","'\\''")+"'";
const sandbox={enabled:true,failIfUnavailable:true,allowUnsandboxedCommands:false,autoAllowBashIfSandboxed:false,
 filesystem:{allowWrite:[project,state],allowRead:[root,state],denyRead:[join(root,'evals')]},
 network:{allowedDomains:['api.anthropic.com','claude.ai','platform.claude.com','console.anthropic.com'],strictAllowlist:true}};
const evidence={attempt,project,requestedModel:canonicalModel,commandPolicyVersion:'finite-cli-status-v2',sandbox,modelDiscovery:null,preflight:null,task:null};
const save=()=>writeFile(join(attempt,'evidence.json'),JSON.stringify(evidence,null,2));
async function discoverModels(){
 let release;const gate=new Promise(resolve=>release=resolve),controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(Error('model discovery timed out')),30000);
 const q=query({prompt:(async function*(){await gate;})(),options:{cwd:project,env,tools:[],settingSources:[],strictMcpConfig:true,permissionMode:'dontAsk',abortController:controller}});
 try{return (await q.supportedModels()).map(({value,resolvedModel,displayName})=>({value,resolvedModel,displayName}));}
 finally{clearTimeout(timer);release();q.close();await q.return();}
}
async function parentTask({prompt,command,workflow,readPaths,schema,timeoutMs}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('integrated task timed out')),timeoutMs);
 const allowedCommands=new Set([command,command+'; echo "EXIT_STATUS=$?"']);
 const permissions=[],activity=[],models=new Set(),modelUsage={};let initModel,completed,execution;
 const canUseTool=async(tool,input,context)=>{
  let allowed=false;const path=typeof input.file_path==='string'?resolve(project,input.file_path):typeof input.path==='string'?resolve(project,input.path):project;
  if(tool==='Read'||tool==='Grep'||tool==='Glob')allowed=(within(project,path)&&!path.endsWith('/control.json'))||readPaths.some(base=>path===base||within(base,path));
  if(tool==='Write'||tool==='Edit')allowed=path===workflow;
  if(tool==='Bash')allowed=allowedCommands.has(input.command?.trim())&&!input.dangerouslyDisableSandbox&&!input.dangerously_disable_sandbox;
  if(tool==='StructuredOutput')allowed=true;
  permissions.push({tool,path:['Read','Grep','Glob','Write','Edit'].includes(tool)?path:undefined,command:tool==='Bash'?safeText(input.command):undefined,allowed,toolUseID:context.toolUseID});
  return allowed?{behavior:'allow',updatedInput:input}:{behavior:'deny',message:'This evaluation authorizes reading fixture/skill files, writing the designated workflow, and the exact fixture CLI command only.'};
 };
 try{
  for await(const message of query({prompt,options:{cwd:project,env,model:canonicalModel,effort:'high',tools:['Read','Grep','Glob','Write','Edit','Bash'],settingSources:[],strictMcpConfig:true,
   permissionMode:'default',permissionPrompts:'host',canUseTool,sandbox,abortController:controller,
   hooks:{PreToolUse:[{hooks:[async()=>({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'ask',permissionDecisionReason:'Evaluation host approval required'}})]}]},
   ...(schema?{outputFormat:{type:'json_schema',schema}}:{})}})){
   if(message.type==='system'&&message.subtype==='init')initModel=message.model;
   if(message.type==='assistant'&&message.message?.model)models.add(message.message.model);
   for(const block of message.message?.content??[]){
    if(block.type==='tool_use')activity.push({id:block.id,tool:block.name,input:block.name==='Bash'?{command:safeText(block.input?.command)}:['Read','Write','Edit'].includes(block.name)?{file_path:block.input?.file_path}:undefined});
    if(block.type==='tool_result'){
     const tool=activity.find(item=>item.id===block.tool_use_id);
     if(tool?.tool==='Bash'&&allowedCommands.has(tool.input.command)){const text=typeof block.content==='string'?block.content:block.content?.filter(part=>part.type==='text').map(part=>part.text).join('\n')??'';
      const status=/EXIT_STATUS=(\d+)/.exec(text)??/^Exit code (\d+)/m.exec(text);
      execution={isError:block.is_error??false,cliExitCode:status?Number(status[1]):block.is_error?null:0,output:safeText(text,60000)};
      for(const line of text.split('\n'))try{const value=JSON.parse(line);if(value&&typeof value==='object'&&Object.hasOwn(value,'result')&&Object.hasOwn(value,'agentCount'))execution.workflowOutput=value;}catch{}
     }
    }
   }
   if(message.type==='result'){completed={subtype:message.subtype,isError:message.is_error??false,result:safeText(message.result,20000),structuredOutput:message.structured_output,errors:message.errors?.map(error=>safeText(error)),usage:message.usage};Object.assign(modelUsage,message.modelUsage??{});}
  }
  return {initModel,reportedModels:[...models],modelUsage,permissions,activity,completed,execution};
 }catch(error){return {initModel,reportedModels:[...models],modelUsage,permissions,activity,completed,execution,error:safeText(error.message)};}
 finally{clearTimeout(timer);}
}
try{
 await access(authSource);await symlink(authSource,authLink);linked=true;
 const fixture=await createFullTaskFixture(project);
 evidence.modelDiscovery=await discoverModels();await save();
 if(!evidence.modelDiscovery.some(model=>model.resolvedModel===canonicalModel||model.value===canonicalModel))throw Error('Requested exact Haiku 5.5 model is unavailable; no fallback performed');
 const contextFile=join(project,'host-context.json');await writeFile(contextFile,JSON.stringify({id:'full-task-claude',revision:'1',providers:{claude:{forcedModel:canonicalModel,forcedEffort:'high'}}}),{mode:0o600});
 const cli=join(root,'scripts/autocode.mjs'),preflightWorkflow=join(project,'infra-preflight.js'),preflightRun=join(project,'preflight-run');
 await writeFile(preflightWorkflow,'export const meta={name:"infra-preflight",description:"Check nested provider access"};return await agent("Return exactly NESTED_CLAUDE_READY. Do not use tools.");');
 const commandFor=(workflow,runDir)=>[process.execPath,cli,'run',workflow,'--provider','claude','--cwd',project,'--run-dir',runDir,'--context',contextFile,'--sandbox','read-only'].map(shell).join(' ');
 const preflightCommand=commandFor(preflightWorkflow,preflightRun);
 evidence.preflight=await parentTask({prompt:`Execute one Bash tool call with the command field byte-for-byte equal to this JSON value: ${JSON.stringify(preflightCommand)}. The Bash tool itself reports the exit status. Report the tool output and status after that call. This is an infrastructure probe, not the billing review task.`,command:preflightCommand,workflow:join(project,'unused-preflight-author.js'),readPaths:[],timeoutMs:120000});
 await save();
 if(evidence.preflight.execution?.isError||evidence.preflight.execution?.cliExitCode!==0||evidence.preflight.execution?.workflowOutput?.result!=='NESTED_CLAUDE_READY'||evidence.preflight.execution.workflowOutput.failures?.length)throw Error('Nested Claude infrastructure preflight failed; blind task was not started');
 if(process.argv.includes('--preflight-only')){evidence.preflightOnly=true;evidence.passed=true;await save();process.stdout.write(JSON.stringify({attempt,preflight:evidence.preflight,passed:true},null,2)+'\n');}
 else {
 const workflow=join(project,'review-workflow.js'),runDir=join(project,'run'),command=commandFor(workflow,runDir);
 const prompt=`${FULL_TASK}\n\nRead the current installed Autocode skill at ${join(root,'SKILL.md')} before authoring. Read its referenced authoring guidance as needed. Complete the entire task in this one session: author ${workflow}, execute it once using the exact command below, inspect ${join(runDir,'journal.jsonl')} and the actual CLI result, then return the same findings from the workflow result. The workflow itself and skeptical-verifier must return the report shape shown below. Include labels reviewer-1, reviewer-2 and skeptical-verifier. Context already forces every delegated call to exact model ${canonicalModel}. Keep the original README.md, package.json and src files unchanged.\n\nExact Bash command field (copy this JSON string value byte-for-byte; the tool reports exit status itself):\n${JSON.stringify(command)}\n\nReport JSON Schema:\n${JSON.stringify(FULL_TASK_REPORT_SCHEMA)}\n\nA failed execution is a recorded evaluation outcome: report it directly rather than launching a replacement run. Completion requires the actual CLI execution and journal containing at least three successful delegated calls, two independent parallel reviews followed by skeptical verification. The final report is the workflow's actual report, with no separate post-execution audit.`;
 evidence.task=await parentTask({prompt,command,workflow,readPaths:[join(root,'SKILL.md'),join(root,'references')],schema:FULL_TASK_REPORT_SCHEMA,timeoutMs:600000});
 const workflowOutput=evidence.task.execution?.workflowOutput;
 const journal=await readFile(join(runDir,'journal.jsonl'),'utf8').then(text=>text.split('\n').filter(Boolean).map(JSON.parse)).catch(()=>[]);
 const report=evidence.task.completed?.structuredOutput??(()=>{try{return JSON.parse(evidence.task.completed?.result??'');}catch{return null;}})();
 evidence.task.journal=journal;evidence.task.workflowSource=await readFile(workflow,'utf8').catch(()=>null);
 evidence.task.requestedDelegateModels=[...new Set(journal.filter(event=>event.type==='started').map(event=>event.model))];
 evidence.task.score=await scoreFullTask({report,workflowResult:workflowOutput?.result,journal,project,sourceHashes:fixture.sourceHashes});
 evidence.task.skillRead=evidence.task.activity.some(event=>event.tool==='Read'&&event.input?.file_path===join(root,'SKILL.md'));
 evidence.task.apiFailures=journal.filter(event=>['failed','run-failed'].includes(event.type));
 evidence.passed=!evidence.task.execution?.isError&&evidence.task.execution?.cliExitCode===0&&evidence.task.score.passed&&evidence.task.skillRead&&workflowOutput?.failures?.length===0&&evidence.task.apiFailures.length===0&&evidence.task.requestedDelegateModels.every(model=>model===canonicalModel)&&evidence.task.completed?.subtype==='success';
 await save();process.stdout.write(JSON.stringify({attempt,requestedModel:canonicalModel,passed:evidence.passed,initModel:evidence.task.initModel,reportedModels:evidence.task.reportedModels,delegateModels:evidence.task.requestedDelegateModels,score:evidence.task.score,apiFailures:evidence.task.apiFailures},null,2)+'\n');if(!evidence.passed)process.exitCode=1;
 }
}catch(error){evidence.error=safeText(error.message);evidence.passed=false;await save();process.stdout.write(JSON.stringify({attempt,error:evidence.error,preflight:evidence.preflight,passed:false},null,2)+'\n');process.exitCode=1;}
finally{if(linked)await unlink(authLink);}
