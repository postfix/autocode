import {createHash} from 'node:crypto';
import {mkdir,readdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);

export const FULL_TASK=`Review the billing/cart project in the current directory against its README.md specification. Read README.md and the implementation under src/. Find demonstrated correctness defects within the documented input domain; distinguish bugs from intentional policy choices. Do not modify project source or specification files.
Use the installed Autocode skill to author a workflow for this task and execute it. Delegate independent reviews in parallel using labels reviewer-1 and reviewer-2, then delegate skeptical verification using label skeptical-verifier. The verifier must challenge candidates, reject unsupported claims, and retain only demonstrated defects. Use at least three real delegated agent calls. The skeptical verifier must return the final findings object, and the workflow itself must return that same object. Inspect the actual CLI result and reproduce it in your final report; do not perform a separate replacement audit afterward. Each finding must contain project-relative file, positive line number, function symbol, title, concrete evidence, and reproduction: {args: [numeric or boolean function arguments], expected: numeric or boolean policy result, actual: numeric or boolean implementation result}. Supply a minimal valid-domain counterexample with handworked expected and actual values; this does not require a shell tool. Do not report speculative improvements or correct behavior as defects.`;
export const FULL_TASK_REPORT_SCHEMA={type:'object',properties:{findings:{type:'array',items:{type:'object',properties:{file:{type:'string'},line:{type:'integer',minimum:1},symbol:{type:'string'},title:{type:'string'},evidence:{type:'string'},reproduction:{type:'object',properties:{args:{type:'array',items:{type:['number','boolean']},minItems:1,maxItems:3},expected:{type:['number','boolean']},actual:{type:['number','boolean']}},required:['args','expected','actual'],additionalProperties:false}},required:['file','line','symbol','title','evidence','reproduction'],additionalProperties:false}}},required:['findings'],additionalProperties:false};

const files={
 'package.json':JSON.stringify({name:'billing-cart-review',private:true,type:'module'},null,2)+'\n',
 'README.md':`# Billing and cart policies

This package calculates checkout totals and partial refunds. All monetary amounts are integer cents. Monetary inputs and intermediate totals are nonnegative safe integers below one billion; quantities, tax rates and flags satisfy the domains below. Callers already validate object shapes and unit prices. These functions do not need to handle unsupported input types, currencies, missing fields, or concurrent mutation.

## Checkout

A cart line has a unitPriceCents and quantity. validateQuantity must return true exactly for integer quantities from 1 through 99, inclusive. buildCart rejects a line whose quantity fails that check.

A member receives a 10 percent merchandise discount when the original merchandise subtotal is at least 10000 cents. Other purchases receive no discount. discountedSubtotal returns the merchandise amount after rounding the discount down to whole cents. Shipping eligibility uses the discounted merchandise amount.

Standard shipping costs 499 cents below 5000 cents of discounted merchandise and is free at or above that amount. Express shipping always costs 1299 cents, regardless of merchandise value.

Tax applies to discounted merchandise only, not shipping. The tax rate is an integer number of basis points from 0 to 10000 inclusive. taxCents rounds the tax to the nearest whole cent, with exact half-cent ties rounded upward.

buildCart returns merchandiseCents, shippingCents, taxCents and totalCents. totalCents is their sum.

## Refunds and allocation

refundAmount receives the total merchandise amount actually paid after discounts, a positive purchased unit count, and an integer returned unit count from zero through the purchased count. It returns floor(totalPaidCents * returnedUnits / purchasedUnits). Repeated refund calls are independent quote calculations, not a refund ledger.

allocateCents divides a nonnegative integer amount across a positive integer number of recipients. Amounts must sum to the original total, differ by at most one cent, and place any remainder cents on the earliest recipients.

The modules are dependency-free ES modules and can be inspected or imported with Node. The repository intentionally does not provide a public test suite; review against these policies.
`,
 'src/quantity.mjs':`export function validateQuantity(quantity) {
  return Number.isInteger(quantity) && quantity >= 0 && quantity <= 99;
}
`,
 'src/pricing.mjs':`export function discountedSubtotal(subtotalCents, member) {
  const discount = member && subtotalCents > 10000 ? Math.floor(subtotalCents * 0.10) : 0;
  return subtotalCents - discount;
}
`,
 'src/shipping.mjs':`export function shippingCost(merchandiseCents, express) {
  if (merchandiseCents >= 5000) return 0;
  return express ? 1299 : 499;
}
`,
 'src/refunds.mjs':`export function refundAmount(totalPaidCents, purchasedUnits, returnedUnits) {
  return Math.ceil(totalPaidCents * returnedUnits / purchasedUnits);
}
`,
 'src/tax.mjs':`export function taxCents(merchandiseCents, basisPoints) {
  return Math.round(merchandiseCents * basisPoints / 10000);
}
`,
 'src/allocation.mjs':`export function allocateCents(totalCents, recipients) {
  const base = Math.floor(totalCents / recipients);
  const remainder = totalCents % recipients;
  return Array.from({length: recipients}, (_, index) => base + (index < remainder ? 1 : 0));
}
`,
 'src/cart.mjs':`import {validateQuantity} from './quantity.mjs';
import {discountedSubtotal} from './pricing.mjs';
import {shippingCost} from './shipping.mjs';
import {taxCents} from './tax.mjs';

export function buildCart({lines, member = false, express = false, taxBasisPoints = 0}) {
  for (const line of lines) if (!validateQuantity(line.quantity)) throw new RangeError('Invalid quantity');
  const subtotal = lines.reduce((total, line) => total + line.unitPriceCents * line.quantity, 0);
  const merchandiseCents = discountedSubtotal(subtotal, member);
  const shippingCents = shippingCost(merchandiseCents, express);
  const tax = taxCents(merchandiseCents, taxBasisPoints);
  return {merchandiseCents,shippingCents,taxCents:tax,totalCents:merchandiseCents+shippingCents+tax};
}
`,
};
const expectedFindings=[
 {file:'src/quantity.mjs',symbol:'validateQuantity',category:'quantity',firstLine:1,lastLine:3},
 {file:'src/pricing.mjs',symbol:'discountedSubtotal',category:'discount',firstLine:1,lastLine:4},
 {file:'src/shipping.mjs',symbol:'shippingCost',category:'shipping',firstLine:1,lastLine:4},
 {file:'src/refunds.mjs',symbol:'refundAmount',category:'refund',firstLine:1,lastLine:3},
];
const decoys=[{file:'src/tax.mjs',symbol:'taxCents'},{file:'src/allocation.mjs',symbol:'allocateCents'}];
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function createFullTaskFixture(project){
 project=resolve(project);await mkdir(project,{recursive:true});
 if((await readdir(project)).length)throw Error('Full-task fixture requires an empty project directory');
 for(const [file,source] of Object.entries(files)){await mkdir(join(project,file,'..'),{recursive:true});await writeFile(join(project,file),source);}
 await execute('git',['init','--quiet',project]);
 await execute('git',['-C',project,'add','.']);
 await execute('git',['-C',project,'-c','user.name=Evaluation','-c','user.email=evaluation@example.test','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','--quiet','-m','Initial billing package']);
 return {sourceHashes:Object.fromEntries(Object.entries(files).map(([file,source])=>[file,hash(source)])),expectedFindings:structuredClone(expectedFindings),decoys:structuredClone(decoys)};
}

function delegationScore(events){
 const starts=events.map((event,index)=>({...event,index})).filter(event=>event.type==='started');
 const finish=start=>events.findIndex((event,index)=>index>start.index&&event.key===start.key&&event.type==='agent-finished');
 const reviewers=starts.filter(event=>/review|finder|audit|scout/i.test(event.label??'')&&!/verif|skepti|judge/i.test(event.label??''));
 const verifiers=starts.filter(event=>/verif|skepti|judge/i.test(event.label??''));
 const pair=reviewers.flatMap((first,index)=>reviewers.slice(index+1).map(second=>[first,second])).find(([a,b])=>finish(a)>b.index&&finish(b)>a.index);
 const verifiedAfterReviews=!!pair&&verifiers.some(verifier=>verifier.index>Math.max(...pair.map(finish))&&finish(verifier)>verifier.index);
 return {agentCalls:starts.length,completedAgentCalls:starts.filter(start=>finish(start)>start.index).length,reviewerCalls:reviewers.length,verificationCalls:verifiers.length,parallelReviewers:!!pair,verifiedAfterReviews,passed:starts.length>=3&&!!pair&&verifiedAfterReviews};
}
async function runtimeOracle(project){
 const load=async file=>import(pathToFileURL(join(project,file)).href);
 const [{validateQuantity},{discountedSubtotal},{shippingCost},{refundAmount},{taxCents},{allocateCents}]=await Promise.all(['quantity','pricing','shipping','refunds','tax','allocation'].map(name=>load(`src/${name}.mjs`)));
 const witnesses=[
  {category:'quantity',input:[0],expected:false,actual:validateQuantity(0)},
  {category:'discount',input:[10000,true],expected:9000,actual:discountedSubtotal(10000,true)},
  {category:'shipping',input:[5000,true],expected:1299,actual:shippingCost(5000,true)},
  {category:'refund',input:[10000,3,1],expected:3333,actual:refundAmount(10000,3,1)},
 ];
 return {witnesses,defectsConfirmed:witnesses.every(value=>JSON.stringify(value.actual)!==JSON.stringify(value.expected)),decoysCorrect:taxCents(1,5000)===1&&JSON.stringify(allocateCents(10,3))==='[4,3,3]'};
}
async function semanticProof(project,expected,reproduction){
 if(!reproduction||!Array.isArray(reproduction.args))return {valid:false};
 const args=reproduction.args;
 const cents=value=>Number.isSafeInteger(value)&&value>=0&&value<1e9;
 let policy;
 if(expected.category==='quantity'){
  if(args.length!==1||typeof args[0]!=='number'||!Number.isFinite(args[0]))return {valid:false};
  policy=Number.isInteger(args[0])&&args[0]>=1&&args[0]<=99;
 }else if(expected.category==='discount'){
  if(args.length!==2||!cents(args[0])||typeof args[1]!=='boolean')return {valid:false};
  policy=args[1]&&args[0]>=10000?args[0]-Math.floor(args[0]/10):args[0];
 }else if(expected.category==='shipping'){
  if(args.length!==2||!cents(args[0])||typeof args[1]!=='boolean')return {valid:false};
  policy=args[1]?1299:args[0]>=5000?0:499;
 }else if(expected.category==='refund'){
  if(args.length!==3||!cents(args[0])||!Number.isSafeInteger(args[1])||args[1]<1||!Number.isSafeInteger(args[2])||args[2]<0||args[2]>args[1]||!Number.isSafeInteger(args[0]*args[2]))return {valid:false};
  policy=Math.floor(args[0]*args[2]/args[1]);
 }
 const implementation=await import(pathToFileURL(join(project,expected.file)).href);
 const actual=implementation[expected.symbol](...args);
 return {valid:Object.is(actual,reproduction.actual)&&Object.is(policy,reproduction.expected)&&!Object.is(actual,policy),actual,expected:policy,args};
}

export async function scoreFullTask({report,workflowResult,journal,project,sourceHashes}){
 project=resolve(project);
 if(typeof journal==='string')journal=(await readFile(journal,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
 if(!Array.isArray(journal))throw TypeError('Full-task score requires actual journal events or a journal path');
 const sourceChanges=[];
 for(const [file,expected] of Object.entries(sourceHashes??{})){
  const actual=await readFile(join(project,file)).then(hash,()=>null);if(actual!==expected)sourceChanges.push(file);
 }
 const sourceUnchanged=Object.keys(sourceHashes??{}).length===Object.keys(files).length&&!sourceChanges.length;
 const findings=report?.findings??report?.result?.findings;
 const completeProof=value=>Array.isArray(value?.findings)&&value.findings.length===expectedFindings.length&&value.findings.every(finding=>typeof finding.file==='string'&&typeof finding.symbol==='string'&&Number.isSafeInteger(finding.line)&&typeof finding.title==='string'&&finding.title.trim()&&typeof finding.evidence==='string'&&finding.evidence.trim()&&finding.reproduction);
 const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 const signatures=value=>value.findings.map(finding=>JSON.stringify(canonical(finding))).sort().join('\n');
 const workflowMatchesReport=completeProof(report)&&completeProof(workflowResult)&&signatures(report)===signatures(workflowResult);
 const verifierKeys=new Set(journal.filter(event=>event.type==='started'&&/verif|skepti|judge/i.test(event.label??'')).map(event=>event.key));
 const verifierMatchesWorkflow=completeProof(workflowResult)&&journal.some(event=>event.type==='result'&&verifierKeys.has(event.key)&&completeProof(event.result)&&signatures(event.result)===signatures(workflowResult));
 const matchedFindings=[],falsePositives=[],decoyFindings=[];
 for(const finding of Array.isArray(findings)?findings:[]){
  const file=typeof finding.file==='string'?finding.file.replaceAll('\\','/').replace(/^\.\//,''):'';
  const localFile=file.startsWith('/')?relative(project,file).split(sep).join('/'):file;
  const symbol=typeof finding.symbol==='string'?finding.symbol.split('.').at(-1):'';
  const expected=expectedFindings.find(item=>item.file===localFile&&item.symbol===symbol);
  if(decoys.some(item=>item.file===localFile&&item.symbol===symbol))decoyFindings.push(finding);
  const semantic=sourceUnchanged&&expected?await semanticProof(project,expected,finding.reproduction):{valid:false};
  const validEvidence=semantic.valid&&typeof finding.title==='string'&&finding.title.trim()&&typeof finding.evidence==='string'&&finding.evidence.trim();
  if(!expected||!validEvidence||!Number.isSafeInteger(finding.line)||finding.line<expected.firstLine||finding.line>expected.lastLine||matchedFindings.some(item=>item.category===expected.category))falsePositives.push(finding);
  else matchedFindings.push({...expected,finding});
 }
 const missingFindings=expectedFindings.filter(expected=>!matchedFindings.some(item=>item.category===expected.category));
 const delegation=delegationScore(journal);
 let oracle;try{oracle=sourceUnchanged?await runtimeOracle(project):{defectsConfirmed:false,decoysCorrect:false,error:'Source changed; not executing altered modules'};}catch(error){oracle={error:error.message,defectsConfirmed:false,decoysCorrect:false};}
 return {passed:workflowMatchesReport&&verifierMatchesWorkflow&&Array.isArray(findings)&&sourceUnchanged&&!missingFindings.length&&!falsePositives.length&&delegation.passed&&oracle.defectsConfirmed&&oracle.decoysCorrect,sourceUnchanged,sourceChanges,workflowMatchesReport,verifierMatchesWorkflow,matchedFindings,missingFindings,falsePositives,decoyFindings,delegation,oracle};
}
