import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';

const requiredPolicy={minQty:1,expressCents:1299};
const hash=value=>createHash('sha256').update(value).digest('hex');
export const REVIEW_CONTEXT_STAGES=[
 ['R1 Red Team','Red Team','round-1-red-team.md'],
 ['R1 Fix Red Team','Fix Red Team','round-1-red-team-fixes.md'],
 ['R1 QA','QA','round-1-qa.md'],
 ['R2 Red Team','Red Team','round-2-red-team.md'],
 ['R2 QA','QA','round-2-qa.md'],
];
export async function snapshotReviewContext(project){
 const files={};
 async function visit(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
   const file=join(directory,entry.name);
   if(entry.isDirectory())await visit(file);
   else files[relative(project,file).split('\\').join('/')]=entry.isSymbolicLink()?'SYMLINK':hash(await readFile(file));
  }
 }
 await visit(project);return files;
}
export async function createReviewContextFixture(project){
 project=resolve(project);await mkdir(project,{recursive:true});
 if((await readdir(project)).length)throw Error('Context fixture requires an empty project directory');
 const fixture={project,policyPath:join(project,'policy.json'),packetPath:join(project,'packet.md'),evidencePath:join(project,'evidence.txt'),reportsDir:join(project,'reports'),nonce:randomUUID(),requiredPolicy};
 await mkdir(fixture.reportsDir);
 await writeFile(fixture.policyPath,JSON.stringify({minQty:0,expressCents:0})+'\n');
 await writeFile(fixture.evidencePath,`EVIDENCE_NONCE=${fixture.nonce}\n`);
 await writeFile(fixture.packetPath,`# Matched context retrieval and repair task

Work only inside this fixture project. This is a small policy review and repair, not a Software Factory design-quality benchmark. Do not spawn agents, launch other workflows or use additional providers. The workflow already delegates each stage.

The entire current subject is policy.json. Its required exact object is {"minQty":1,"expressCents":1299}; extra keys are not permitted. Review stages inspect independently and never edit policy.json. Only fix stages may edit policy.json. Every stage may write only the report path supplied in its prompt. Preserve packet.md, prior reports and evidence.txt. Use tools to inspect files, compute the actual SHA256 of policy.json and write reports. A hand-invented hash is not acceptable. Hash policy.json after any authorized fix. Set subjectHash to that actual lowercase SHA256. Report paths must match the supplied stage report path.

R1 Red Team: inspect policy.json and evidence.txt. Save the exact EVIDENCE_NONCE line from evidence.txt in your report, alongside your independent findings. The nonce and evidence-file contents must NOT appear anywhere in your structured result (including summary, findings and limitations). The structured result should say the initial evidence was saved in its report, without reproducing it. Identify concrete deviations from the required policy using stable finding IDs; return NEEDS_REVISION while there are findings.

Fix Red Team: repair the policy exactly as required and save your closure report. Return FIXED only for actual repairs; changedFiles must list only policy.json if changed. Never edit evidence.txt or a prior report. A fix claim is not independent QA closure.

QA: independently read the complete current policy, verify it equals the required exact object and verify the pending fix closures using the supplied report references. Return PASS only with zero findings and unresolvedIds on the actual current subject hash. Do not copy the nonce into your summary. Save your report. Review changedFiles must be empty.

R2 Red Team: independently recheck policy.json. The harness has removed evidence.txt after R1; do not recreate it. Retrieve the exact nonce by selectively reading the original R1 Red Team report through the reportRefs supplied in your current prompt. Include that recovered nonce in your structured summary, explicitly stating it came from the referenced report. This demonstrates report-reference retrieval rather than full historical context passing. Return SOUND only when the policy is correct, with no findings or unresolvedIds. Save your current report. Do not edit earlier reports or any other files.

Use full sentences for actionable findings. Keep summaries concise. Preserve stable finding IDs when mentioning an existing issue. Report only actual limitations. The final workflow must be clean only after independent matching-hash QA; all reports must exist before their structured results return.
`);
 fixture.initialHashes=await snapshotReviewContext(project);
 return fixture;
}
export async function retireReviewContextEvidence(fixture,result){
 const report=await readFile(join(fixture.reportsDir,'round-1-red-team.md'),'utf8');
 if(!report.includes(`EVIDENCE_NONCE=${fixture.nonce}`))throw Error('R1 report did not preserve the exact evidence nonce');
 if(JSON.stringify(result).includes(fixture.nonce))throw Error('R1 structured result leaked the evidence nonce');
 await unlink(fixture.evidencePath);
}
export function reviewContextCommandReceipt(fixture,{command,output,exitCode,id,source='Codex command completion'}){
 const reportPath=join(fixture.reportsDir,'round-1-red-team.md');
 const commandText=typeof command==='string'?command:JSON.stringify(command??'');
 const reportPathMatch=!commandText.includes(fixture.nonce)&&/\b(cat|grep|rg|sed|head|tail)\b|readFile/.test(commandText)&&[reportPath,'reports/round-1-red-team.md'].some(path=>commandText.includes(path));
 return {source,tool:'command_execution',id:id??null,command:commandText,reportPath,reportPathMatch,containsNonce:(typeof output==='string'?output:JSON.stringify(output??'')).includes(fixture.nonce),success:exitCode===0};
}
export function reviewContextToolReceipt(fixture,{tool,input,output,isError,id,source='Claude tool result'}){
 if(tool==='Bash')return {...reviewContextCommandReceipt(fixture,{command:input?.command,output,exitCode:isError?1:0,id,source}),tool};
 const reportPath=join(fixture.reportsDir,'round-1-red-team.md');
 const path=tool==='Read'?input?.file_path:tool==='Grep'?input?.path:undefined;
 return {source,tool,id:id??null,reportPath,reportPathMatch:typeof path==='string'&&resolve(fixture.project,path)===reportPath&&!JSON.stringify(input).includes(fixture.nonce),containsNonce:(typeof output==='string'?output:JSON.stringify(output??'')).includes(fixture.nonce),success:isError!==true};
}
export async function scoreReviewContext({fixture,result,calls}){
 const workflow=result?.result??result,checks={};
 const final=await snapshotReviewContext(fixture.project);
 let policy;try{policy=JSON.parse(await readFile(fixture.policyPath,'utf8'));}catch{}
 checks.policyRepaired=policy?.minQty===1&&policy?.expressCents===1299&&Object.keys(policy).length===2;
 checks.clean=workflow?.status==='clean'&&workflow.rounds===2&&Array.isArray(workflow.openFindings)&&workflow.openFindings.length===0;
 checks.noFailures=Array.isArray(result?.failures)&&result.failures.length===0;
 checks.stageSequence=JSON.stringify(calls.map(call=>[call.label,call.phase]))===JSON.stringify(REVIEW_CONTEXT_STAGES.map(([label,phase])=>[label,phase]));
 checks.reportFiles=true;checks.actualHashes=true;checks.permittedChanges=true;
 for(const call of calls){
  const stage=REVIEW_CONTEXT_STAGES.find(([label])=>label===call.label);
  if(!stage){checks.reportFiles=false;checks.permittedChanges=false;continue;}
  const expectedReport=join(fixture.reportsDir,stage[2]);
  const report=await readFile(expectedReport,'utf8').catch(()=>null);
  if(!report||resolve(fixture.project,call.result?.reportPath??'')!==expectedReport)checks.reportFiles=false;
  if(!call.after?.['policy.json']||call.result?.subjectHash!==call.after['policy.json']||(!call.phase.startsWith('Fix')&&call.before?.['policy.json']!==call.after['policy.json']))checks.actualHashes=false;
  const allowed=new Set([`reports/${stage[2]}`,...(call.phase.startsWith('Fix')?['policy.json']:[])]);
  const changed=[...new Set([...Object.keys(call.before??{}),...Object.keys(call.after??{})])].filter(file=>call.before?.[file]!==call.after?.[file]);
  if(changed.some(file=>!allowed.has(file)))checks.permittedChanges=false;
 }
 const first=calls.find(call=>call.label==='R1 Red Team'),second=calls.find(call=>call.label==='R2 Red Team');
 const firstReport=await readFile(join(fixture.reportsDir,'round-1-red-team.md'),'utf8').catch(()=>null);
 checks.initialEvidenceStored=!!firstReport?.includes(`EVIDENCE_NONCE=${fixture.nonce}`)&&!JSON.stringify(first?.result??null).includes(fixture.nonce);
 checks.sourceRetired=!Object.hasOwn(final,'evidence.txt')&&calls.slice(1).every(call=>!Object.hasOwn(call.before??{},'evidence.txt')&&!Object.hasOwn(call.after??{},'evidence.txt'));
 checks.retrieved=!!second?.result?.summary?.includes(fixture.nonce)&&!!second?.prompt?.includes(join(fixture.reportsDir,'round-1-red-team.md'));
 checks.reportReadReceipt=(second?.toolReceipts??[]).some(receipt=>receipt.success===true&&receipt.reportPathMatch===true&&receipt.containsNonce===true&&receipt.reportPath===join(fixture.reportsDir,'round-1-red-team.md'));
 const closedBodies=(first?.result?.findings??[]).flatMap(finding=>[finding.detail,finding.fix]).filter(text=>typeof text==='string'&&text.length>=24);
 checks.compactPayload=!!second&&!second.prompt.includes(fixture.nonce)&&!second.prompt.includes('"history"')&&!second.prompt.includes(JSON.stringify(first?.result))&&closedBodies.every(body=>!second.prompt.includes(JSON.stringify(body)));
 const parent=JSON.stringify(workflow??null);
 checks.compactParent=!parent.includes(fixture.nonce)&&!parent.includes('"history"')&&closedBodies.every(body=>!parent.includes(JSON.stringify(body)));
 checks.hashClosure=!!final['policy.json']&&workflow?.finalHash===final['policy.json']&&calls.filter(call=>call.phase==='QA').length===2&&calls.filter(call=>call.phase==='QA').every(call=>call.result?.verdict==='PASS'&&call.result.subjectHash===final['policy.json']&&!call.result.findings?.length&&!call.result.unresolvedIds?.length);
 const allowedFinal=new Set(['packet.md','policy.json',...REVIEW_CONTEXT_STAGES.map(([, ,file])=>`reports/${file}`),...(result?.runId?[`.autocode/runs/${result.runId}.json`]:[])]);
 checks.permittedChanges&&=final['packet.md']===fixture.initialHashes['packet.md']&&Object.keys(final).every(file=>allowedFinal.has(file));
 return {passed:Object.values(checks).every(value=>value===true),checks,initialHashes:fixture.initialHashes,finalHashes:final};
}
