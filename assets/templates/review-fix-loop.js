export const meta = {
  name: 'review-fix-loop',
  description: 'Review and fix with current findings and retrievable report references',
  phases: [{title:'Red Team'},{title:'Fix Red Team'},{title:'QA'},{title:'Fix QA'}]
};
// Launch contract: await the result, or use a host-native background task with success/failure delivery.
// Custom notification hosts must supply both onComplete and onFailure; bare --background is rejected.

if (!args || typeof args.packet !== 'string' || !args.packet || typeof args.reportRoot !== 'string' || !args.reportRoot) throw new TypeError('packet and reportRoot are required');
if (!Number.isSafeInteger(args.maxRounds) || args.maxRounds < 1 || args.maxRounds > 250) throw new TypeError('maxRounds must be an integer from 1 to 250');
const packet = args.packet;
const reportRoot = args.reportRoot.endsWith('/') ? args.reportRoot : args.reportRoot + '/';
const schema = {
  type:'object', additionalProperties:false,
  properties:{
    verdict:{type:'string',enum:['SOUND','PASS','NEEDS_REVISION','UNKNOWN','FIXED','PARTIAL','NO_CHANGE']},
    subjectHash:{type:'string',minLength:1,pattern:'\\S'}, reportPath:{type:'string',minLength:1,pattern:'\\S'}, summary:{type:'string'},
    findings:{type:'array',items:{type:'object',additionalProperties:false,properties:{
      id:{type:'string'},severity:{type:'string',enum:['BLOCKER','MAJOR','MINOR']},
      title:{type:'string'},detail:{type:'string'},fix:{type:'string'}
    },required:['id','severity','title','detail','fix']}},
    unresolvedIds:{type:'array',items:{type:'string'}},
    changedFiles:{type:'array',items:{type:'string'}},
    limitations:{type:'array',items:{type:'string'}}
  },required:['verdict','subjectHash','reportPath','summary','findings','unresolvedIds','changedFiles','limitations']
};
const open = new Map();
const reportRefs = [];
let latestChange = null;
const maxRounds = args.maxRounds;
const reference = (result, round, title) => ({round,stage:title,verdict:result.verdict,subjectHash:result.subjectHash,reportPath:result.reportPath});
const activeDetails = () => [...open.values()];
const openFindings = () => activeDetails().map(({id,severity,title,state,sourceReport,subjectHash,latestReport}) => ({id,severity,title,state,sourceReport,subjectHash,latestReport}));
const context = () => ({openFindings:openFindings(),latestChange,reportRefs});
function remember(result, round, title) {
  const ref = reference(result,round,title);
  reportRefs.push(ref);
  for (const finding of result.findings) {
    const old = open.get(finding.id);
    open.set(finding.id,{...finding,state:'open',sourceReport:old?.sourceReport??result.reportPath,subjectHash:result.subjectHash,latestReport:result.reportPath});
  }
  for (const id of result.unresolvedIds) if (!open.has(id))
    open.set(id,{id,state:'open',sourceReport:result.reportPath,subjectHash:result.subjectHash,latestReport:result.reportPath});
  return ref;
}
function fixContext(review, round, title) {
  const ids = new Set([...review.findings.map(f=>f.id),...review.unresolvedIds]);
  return {findings:activeDetails().filter(f=>ids.has(f.id)),reviewRef:reference(review,round,title),
    pendingClosures:openFindings().map(f=>({id:f.id,state:f.state,sourceReport:f.sourceReport,latestReport:f.latestReport})),reportRefs};
}
function rememberFix(result, round, title, review) {
  remember(result,round,title);
  for (const id of [...review.findings.map(f=>f.id),...review.unresolvedIds]) if(open.has(id))open.get(id).state='pending_verification';
  latestChange = {...reference(result,round,title),changedFiles:result.changedFiles};
}
async function stage(round, title, suffix, instruction, inputs) {
  phase(title);
  const result = await agent(
    'Read the complete task packet at ' + packet + ' and follow it. ' +
    'You are a fresh ' + title + ' agent, round ' + round + '/' + maxRounds + '. ' + instruction +
    ' Use current findings and report references below. Read referenced reports selectively when evidence is missing; do not reload all prior reports. Preserve finding IDs across rounds. FIXED is not independent verification. ' +
    ' Save the report to ' + reportRoot + 'round-' + round + '-' + suffix + '.md. ' +
    'Previous stage data: ' + JSON.stringify(inputs),
    {schema,label:'R' + round + ' ' + title,phase:title,effort:'high'}
  );
  if(!result) throw new Error('Missing ' + title + ' result');
  if(typeof result.subjectHash!=='string'||!result.subjectHash.trim()||typeof result.reportPath!=='string'||!result.reportPath.trim()) throw new TypeError('Review stages require nonblank subjectHash and reportPath');
  return result;
}
for(let round=1; round<=maxRounds; round++){
  log('Round ' + round + '/' + maxRounds);
  const rt = await stage(round,'Red Team','red-team',
    'Independently challenge the complete task packet and current subject. Review only; do not edit the subject. Return SOUND only with zero unresolved findings.',
    context());
  remember(rt,round,'Red Team');
  let rtFix = null;
  if(rt.findings.length || rt.unresolvedIds.length){
    rtFix = await stage(round,'Fix Red Team','red-team-fixes',
      'Fix all substantiated Red Team findings in the permitted subject files. Keep prior requirements and give a closure ledger. Do not relabel missing hard requirements as future work to obtain a pass.',
      fixContext(rt,round,'Red Team'));
    rememberFix(rtFix,round,'Fix Red Team',rt);
  }
  const qa = await stage(round,'QA','qa',
    'Independently verify the full current subject and the Red Team fix closures. Check schema compatibility, source/evidence authority, precise transitions, acceptance rules and observable test rows. Return PASS only with no unresolved current-subject findings. Respect every acceptance requirement in the task packet. Do not edit the subject.',
    {...context(),reviewRef:reference(rt,round,'Red Team')});
  remember(qa,round,'QA');
  const qaVerified = qa.verdict==='PASS' && !qa.findings.length && !qa.unresolvedIds.length && qa.subjectHash===(latestChange?.subjectHash??rt.subjectHash);
  if(qaVerified)open.clear();
  let qaFix = null;
  if(qa.findings.length || qa.unresolvedIds.length){
    qaFix = await stage(round,'Fix QA','qa-fixes',
      'Fix all substantiated QA findings in the permitted subject files; preserve prior closures. Report remaining questions honestly. Your changed bytes are not independently verified until a later review.',
      fixContext(qa,round,'QA'));
    rememberFix(qaFix,round,'Fix QA',qa);
  }
  log('Round ' + round + ': Red Team ' + rt.verdict + '; QA ' + qa.verdict);
  if(rt.verdict==='SOUND' && qaVerified && !rtFix && !qaFix && rt.subjectHash===qa.subjectHash){
    return {status:'clean',rounds:round,openFindings:openFindings(),reportRefs,finalHash:qa.subjectHash,limit:maxRounds};
  }
}
return {status:'round_limit',rounds:maxRounds,openFindings:openFindings(),reportRefs,finalHash:reportRefs.at(-1)?.subjectHash,limit:maxRounds};
