import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runWorkflow} from '../scripts/runtime.mjs';
import {codexAgent} from '../scripts/codex-adapter.mjs';
import {claudeAgent} from '../scripts/claude-adapter.mjs';
const exec=promisify(execFile),root=process.cwd(),cases=[];
await mkdir(join(root,'.scratch'),{recursive:true});
const script='export const meta={name:"embedded-live-check",description:"Read real evidence through a live delegate"};phase("Read");return agent("Read context.txt in the project working directory using exec_command with cat or your available read-only file tool. Read-only permits reading files; do not edit files. Return the exact marker from that file, not a statement about tool access.",{model:args.model,schema:{type:"object",properties:{marker:{type:"string"}},required:["marker"],additionalProperties:false}});';
for(const [provider,model,adapter] of [['codex','gpt-6-luna',codexAgent],['claude','claude-haiku-5-5',claudeAgent]].filter(([provider])=>!process.env.ONLY_PROVIDER||provider===process.env.ONLY_PROVIDER)){
 const directory=await mkdtemp(join(root,'.scratch',`embedded-live-${provider}-`)),project=join(directory,'project'),runDir=join(directory,'external-run');await mkdir(project);
 const marker=randomUUID();await writeFile(join(project,'context.txt'),JSON.stringify({marker}));
 let started;const ready=new Promise(resolve=>started=resolve);const result={provider,model,project,runDir,passed:false};
 const pending=runWorkflow({script,args:{model},runDir,cwd:project,defaultProvider:provider,onProgress:event=>{if(event.type==='agent-started')started();},agent:(prompt,opts,context)=>adapter(prompt,opts,context)});
 try{
  await Promise.race([ready,pending.then(()=>{throw Error('workflow completed before active discovery check');})]);
  result.active=JSON.parse((await exec(process.execPath,[join(root,'scripts/autocode.mjs'),'ps','--json'],{cwd:project})).stdout);
  assert.equal(result.active.length,1);assert.equal(result.active[0].state,'running');assert.equal(result.active[0].controllable,false);
  const output=await pending;assert.equal(output.result.marker,marker);assert.deepEqual(output.failures,[]);
  result.runId=output.runId;result.outputTokens=output.outputTokens;
  result.status=JSON.parse((await exec(process.execPath,[join(root,'scripts/autocode.mjs'),'status',output.runId,'--json'],{cwd:project})).stdout);
  assert.equal(result.status.state,'completed');
  assert.deepEqual(JSON.parse((await exec(process.execPath,[join(root,'scripts/autocode.mjs'),'ps','--json'],{cwd:project})).stdout),[]);
  result.passed=true;
 }catch(error){result.error=error.stack;await pending.catch(()=>{});}
 cases.push(result);await writeFile(join(root,'.scratch','embedded-live-results.json'),JSON.stringify({date:new Date().toISOString(),cases},null,2));
 process.stdout.write(JSON.stringify({provider,passed:result.passed,error:result.error})+'\n');
}
if(cases.some(result=>!result.passed))process.exitCode=1;
