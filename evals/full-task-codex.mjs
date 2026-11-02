import {Codex} from '@openai/codex-sdk';
import {AppServerCodex} from '../scripts/codex-app-server.mjs';
import {mkdir,mkdtemp,symlink,readFile,writeFile,readdir,access,unlink} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {safeText} from '../scripts/run-stats.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const sourceMcp=process.argv.includes('--source-mcp');
const route=sourceMcp?'read-only-MCP-source':'native-Bash';
const scratch=join(root,'.scratch/full-task-codex');await mkdir(scratch,{recursive:true});
async function discover(){
 const client=new AppServerCodex({codexPathOverride:join(root,'node_modules/.bin/codex')});const thread=client.startThread({workingDirectory:root,sandboxMode:'read-only'});
 try{
  await thread.initialize();let cursor;const models=[];
  do{const page=await thread.connection.request('model/list',{includeHidden:true,limit:100,...(cursor?{cursor}:{})});models.push(...page.data);cursor=page.nextCursor;}while(cursor);
  const luna=models.filter(model=>/luna/i.test(JSON.stringify({id:model.id,model:model.model,displayName:model.displayName})));
  const evidence={time:new Date().toISOString(),models:luna.map(model=>({id:model.id,model:model.model,displayName:model.displayName,hidden:model.hidden,supportedReasoningEfforts:model.supportedReasoningEfforts})),availableModelIds:models.map(model=>model.model??model.id)};
  await writeFile(join(scratch,'model-discovery.json'),JSON.stringify(evidence,null,2));
  const exact=luna.find(model=>(model.model??model.id)==='gpt-6-luna')??luna.find(model=>(model.model??model.id)==='gpt-5.6-luna')??luna[0];
  if(!exact)throw Error('Requested Luna model unavailable in pinned native model/list');return {model:exact.model??exact.id,evidence};
 }finally{await thread.close();}
}
const {model,evidence}=await discover();
if(process.argv.includes('--models-only')){console.log(JSON.stringify({model,...evidence}));process.exit(0);}
const {createFullTaskFixture,scoreFullTask,FULL_TASK,FULL_TASK_REPORT_SCHEMA}=await import('./full-task-fixture.mjs');
const project=await mkdtemp(join(scratch,'run-'));
const fixture=await createFullTaskFixture(project);
const home=join(project,'.sdk-state');await mkdir(home,{mode:0o700});
const sourceHome=process.env.CODEX_HOME??join(homedir(),'.codex');
const credentialLinks=[];
try{
for(const name of ['auth.json','config.toml'])try{await access(join(sourceHome,name));const target=join(home,name);await symlink(join(sourceHome,name),target);credentialLinks.push(target);}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir(join(home,'skills'));await symlink(root,join(home,'skills','autocode'),'dir');
const outputFile=join(project,'workflow-output.json');
const runDir=join(project,'run'),workflow=join(project,'review-workflow.js'),contextFile=join(project,'host-context.json');
const sourceAllowlist=Object.keys(fixture.sourceHashes).filter(file=>file==='README.md'||file.startsWith('src/')&&file.endsWith('.mjs'));
const sourceReceiptsFile=join(project,'source-read-receipts.jsonl');
await writeFile(contextFile,JSON.stringify({id:'full-task-codex',revision:model+'-'+route,providers:{codex:{codexHome:home,model,forcedModel:model,...(sourceMcp?{mcpServers:{source_reader:{command:process.execPath,args:[join(root,'evals/full-task-source-mcp.mjs'),project,JSON.stringify(sourceAllowlist),sourceReceiptsFile]}}}:{})}}}),{mode:0o600});
const shell=value=>"'"+value.replaceAll("'","'\\''")+"'";
const cli=[process.execPath,join(root,'scripts/autocode.mjs'),'run',workflow,'--provider','codex','--cwd',project,'--run-dir',runDir,'--context',contextFile,'--sandbox','read-only'].map(shell).join(' ')+` > ${shell(outputFile)}`;
const parentSchema=FULL_TASK_REPORT_SCHEMA;
const sourceRouteInstruction=sourceMcp?`The delegate source-reading route is the configured read-only source_reader MCP server. Every delegated agent() call MUST set disallowedTools: ['Bash'] to avoid the independently proven upstream nested-Bash sandbox failure. Tell each reviewer and verifier to use the real read_project_source MCP tool for README.md and relevant src/*.mjs files; it returns exact file bytes plus hashes. Do not embed source snapshots, use a different provider, or bypass sandboxes. The source MCP allowlist exposes only original README and source modules; no oracle or credentials.`:'';
const prompt=`$autocode ${FULL_TASK}
${sourceRouteInstruction}

Provider-specific execution requirements: Read the installed current skill at ${join(home,'skills/autocode/SKILL.md')} before authoring. You must author a JavaScript workflow at ${workflow}, then execute the actual Autocode CLI yourself in this same session, wait for completion, inspect workflow-output.json and the journal, and return the structured review report. Do not stop after writing the workflow. Use two independent read-only reviewers in parallel labeled reviewer-1 and reviewer-2, followed by a separate skeptical verifier labeled skeptical-verifier. All agents must use Codex model ${model}; the trusted context forces it. Do not use native subagents or fake adapter responses. Keep this bounded to one actual CLI workflow run with at least three completed delegates. Run exactly this command after authoring (no separate evaluator execution): ${cli}. The supplied host-context.json is read-only infrastructure; don't change it or inspect authentication files. Preserve original source files. The findings report JSON Schema is ${JSON.stringify(parentSchema)}. The workflow's final return and the skeptical verifier's own agent result must both use this findings report shape. Your final response must reproduce those verified workflow findings, not a separate parent-only audit. Return the verified findings using the requested report schema, including exact file, line, symbol, title and concrete evidence. Available source code and README are the evidence; do not inspect evaluator scripts outside this project or invent defects.`;
const client=new Codex({env:{...process.env,CODEX_HOME:home},config:{features:{multi_agent:false},sandbox_workspace_write:{network_access:true}}});
const thread=client.startThread({workingDirectory:project,sandboxMode:'workspace-write',skipGitRepoCheck:true,approvalPolicy:'never',model,modelReasoningEffort:'medium'});
let result,error;
try{result=await thread.run(prompt,{outputSchema:parentSchema,signal:AbortSignal.timeout(600000)});}catch(caught){error={message:caught.message,stack:caught.stack};}
await writeFile(join(scratch,'latest-project.txt'),project);
const journal=await readFile(join(runDir,'journal.jsonl'),'utf8').then(value=>value.trim().split('\n').filter(Boolean).map(JSON.parse)).catch(()=>[]);
let report;try{report=JSON.parse(result?.finalResponse??'null');}catch{}
const workflowOutput=await readFile(outputFile,'utf8').then(JSON.parse).catch(()=>null);
const workflowResult=workflowOutput?.result;
const score=report?await scoreFullTask({report,workflowResult,journal,project,sourceHashes:fixture.sourceHashes}):{passed:false,error:'Parent did not return a structured completed report'};
async function sessionModels(directory){const found=[];for(const entry of await readdir(directory,{withFileTypes:true}).catch(()=>[])){const path=join(directory,entry.name);if(entry.isDirectory())found.push(...await sessionModels(path));else if(entry.name.endsWith('.jsonl')){const records=(await readFile(path,'utf8')).split('\n').filter(Boolean);for(const line of records)try{const event=JSON.parse(line);if(event.type==='turn_context'&&event.payload?.model)found.push({session:path,model:event.payload.model});}catch{}}}return found;}
const observed=await sessionModels(join(home,'sessions'));
const agentEvents=journal.filter(event=>event.type==='agent-finished');
const sourceReceipts=sourceMcp?await readFile(sourceReceiptsFile,'utf8').then(text=>text.trim().split('\n').filter(Boolean).map(JSON.parse)).catch(()=>[]):[];
const sourceMcpActivity=journal.filter(event=>event.type==='activity'&&event.status==='completed'&&/read_project_source$/.test(event.tool??''));
const sourceProvenance=!sourceMcp||sourceReceipts.length>0&&sourceReceipts.every(receipt=>receipt.realPath===join(project,receipt.file)&&receipt.sha256===fixture.sourceHashes[receipt.file])&&sourceAllowlist.every(file=>sourceReceipts.some(receipt=>receipt.file===file))&&sourceMcpActivity.length>0;
const checks={...score,sourceProvenance,sourceReadCount:sourceReceipts.length,sourceMcpActivityCount:sourceMcpActivity.length,cliExecuted:result?.items?.some(item=>item.type==='command_execution'&&item.command.includes('scripts/autocode.mjs')&&item.exit_code===0)??false,parentUsedSkill:result?.items?.some(item=>item.type==='command_execution'&&item.command.includes('SKILL.md'))??false,requestedModel:model,observedSessionModels:[...new Set(observed.map(item=>item.model))],allObservedModelsMatch:observed.length>0&&observed.every(item=>item.model===model),completedAgents:agentEvents.length,noJournalFailures:!journal.some(event=>['failed','run-failed'].includes(event.type)),noCliFailures:Array.isArray(workflowOutput?.failures)&&workflowOutput.failures.length===0};
const passed=score.passed&&checks.cliExecuted&&checks.parentUsedSkill&&checks.allObservedModelsMatch&&agentEvents.length>=3&&checks.noJournalFailures&&checks.noCliFailures&&checks.sourceProvenance;
const implementationHashes=Object.fromEntries(await Promise.all(['SKILL.md','scripts/runtime.mjs','scripts/codex-adapter.mjs','scripts/autocode.mjs'].map(async file=>[file,createHash('sha256').update(await readFile(join(root,file))).digest('hex')])));
const evidenceResult={project,model,route,sourceReceipts,implementationHashes,parentThreadId:thread.id,parentConfig:{sandboxMode:'workspace-write',network_access:true,model,forcedDelegateModel:model},checks,report,workflowOutput,usage:result?.usage,error,sessionModels:observed,items:result?.items,sourceHashes:fixture.sourceHashes,workflowSha256:await readFile(workflow).then(value=>createHash('sha256').update(value).digest('hex')).catch(()=>null),journal,passed};
const sanitize=value=>typeof value==='string'?safeText(value,8192):Array.isArray(value)?value.map(sanitize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,sanitize(item)])):value;
const sanitizedEvidence=sanitize(evidenceResult);
await writeFile(join(project,'evaluation.json'),JSON.stringify(sanitizedEvidence,null,2));
await writeFile(join(scratch,'result.json'),JSON.stringify(sanitizedEvidence,null,2));
console.log(JSON.stringify(sanitize({project,model,checks,error,passed})));if(!passed)process.exitCode=1;

}finally{for(const path of credentialLinks)await unlink(path).catch(()=>{});}
