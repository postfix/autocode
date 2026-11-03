export const meta = {
  name: 'exhaustive-review',
  description: 'Discover fresh findings, check them from three angles, and critique coverage',
  phases: [{ title: 'Find' }, { title: 'Verify' }, { title: 'Completeness' }],
};
// Launch contract: await the result, or use a host-native background task with success/failure delivery.
// Custom notification hosts must supply both onComplete and onFailure; bare --background is rejected.


const seen = new Map();
const confirmed = [];
const rejected = [];
const pending = new Map();
const lenses = ['correctness', 'security', 'reproducibility'];
const identity = finding => JSON.stringify([finding.file, finding.id]);
const validVerdict = vote => vote && typeof vote.real === 'boolean' && typeof vote.reason === 'string' && vote.reason.trim();
const unverifiedClaims = () => [...pending.values()].map(panel => ({ finding: panel.finding,
  missingLenses: lenses.filter((_, index) => !validVerdict(panel.votes[index])) }));
const verificationGaps = () => unverifiedClaims().map(panel => `Verification incomplete for ${panel.finding.file} [${panel.finding.id}]: missing ${panel.missingLenses.join(', ')} verdicts`);
const failedTopics = new Map();
const discoveryGaps = () => [...failedTopics.values()].map(topic => `Discovery did not return a validated result for topic: ${topic}`);
let dry = 0;
let rounds = 0;
const maxRounds = args.maxRounds;
if (maxRounds !== undefined && (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > 1000)) throw new TypeError('maxRounds must be an integer from 1 to 1000');
const hasRound = () => maxRounds === undefined || rounds < maxRounds;
let agentCalls = 0;
let budgetExhausted = false;
const admitCalls = count => {
  if (count > 0 && budget.total !== null && budget.remaining() <= 0) { budgetExhausted = true; return false; }
  if (agentCalls + count > 1000) throw new Error('Exhaustive review would exceed the 1000-agent call limit; coverage is incomplete');
  agentCalls += count;
  return true;
};
const findingsSchema = {
  type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', minLength: 1 }, file: { type: 'string' }, line: { type: 'integer', minimum: 1 }, description: { type: 'string' } }, required: ['id', 'file', 'line', 'description'], additionalProperties: false } } }, required: ['findings'],
};
const verdictSchema = {
  type: 'object', properties: { real: { type: 'boolean' }, reason: { type: 'string', minLength: 1 } }, required: ['real', 'reason'],
};

let critique, gaps = [], criticGaps = [];
review: for (;;) {
while (dry < 2 && hasRound()) {
  if (!admitCalls(args.topics.length)) break review;
  rounds++;
  const scans = await parallel(args.topics.map(topic => () =>
    agent(`Round ${rounds}: find new, concrete issues in ${topic}. Return structured findings with a stable id naming the violated invariant, file, line, and description. Reuse an existing id for the same issue even when its wording changes; give distinct issues different ids even on the same line. Already seen issue identities and claims: ${JSON.stringify([...seen.values()])}. Close these coverage gaps within the assigned topic: ${JSON.stringify([...new Set([...gaps, ...discoveryGaps(), ...verificationGaps()])])}.`,
      { phase: 'Find', schema: findingsSchema })));
  scans.forEach((scan, index) => {
    if (scan === null) failedTopics.set(index, args.topics[index]);
    else failedTopics.delete(index);
  });
  const fresh = scans.filter(Boolean).flatMap(scan => scan.findings).filter(finding => {
    // Identity is an explicit finder contract, not inferred from prose or source position.
    if (typeof finding.id !== 'string' || !finding.id.trim()) throw new TypeError('findings require a nonempty stable issue id');
    const key = identity(finding);
    if (seen.has(key)) return false;
    seen.set(key, finding);
    return true;
  });
  log(`Round ${rounds}: ${fresh.length} new findings`);
  if (!fresh.length) dry = failedTopics.size ? 0 : dry + 1;
  else dry = 0;
  for (const finding of fresh) pending.set(identity(finding), {finding, votes: []});
  const panels = [...pending.values()];
  if (!admitCalls(panels.reduce((count, panel) => count + lenses.filter((_, index) => !validVerdict(panel.votes[index])).length, 0))) break review;
  const judged = await parallel(panels.map(panel => () =>
    parallel(lenses.map((lens, index) => () => validVerdict(panel.votes[index]) ? panel.votes[index] :
      agent(`Try to refute this finding through ${lens}: ${JSON.stringify(panel.finding)}. Return real=true only if it survives. Default to real=false if uncertain. Cite concrete evidence in reason.`,
        { phase: 'Verify', schema: verdictSchema })))
      .then(votes => ({ panel, votes }))));
  for (const item of judged.filter(Boolean)) {
    const panel = pending.get(identity(item.panel.finding));
    panel.votes = item.votes;
    if (item.votes.some(vote => !validVerdict(vote))) continue;
    pending.delete(identity(item.panel.finding));
    if (item.votes.filter(vote => vote.real).length >= 2) confirmed.push(item.panel.finding);
    else rejected.push({finding: item.panel.finding, verdicts: item.votes});
  }
}

  if (!admitCalls(1)) break;
  const review = await agent(
    `Check for unsearched areas, unverified claims, and unreadable sources in this review: ${JSON.stringify({ topics: args.topics, confirmed, rounds, failedTopics: [...failedTopics.values()], rejected, unverified: unverifiedClaims() })}. Return concrete gaps that can be investigated within the assigned topics.`,
    { phase: 'Completeness', schema: { type: 'object', properties: { summary: { type: 'string' }, gaps: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'gaps'] } },
  );
  critique = typeof review === 'string' ? review : review?.summary;
  criticGaps = review === null ? ['Completeness check did not return a validated verdict'] : review?.gaps ?? [];
  gaps = [...new Set([...discoveryGaps(), ...verificationGaps(), ...criticGaps])];
  if (!gaps.length || !hasRound()) break;
  dry = 0;
}
gaps = [...new Set([...discoveryGaps(), ...verificationGaps(), ...criticGaps])];
if (budgetExhausted) {
  gaps.push('Output-token budget exhausted before review convergence');
  log('Stopped at the output-token budget; review is incomplete');
}
const converged = !budgetExhausted && dry >= 2 && !gaps.length;
const capped = !budgetExhausted && !converged && maxRounds !== undefined && rounds >= maxRounds;
if (capped) {
  gaps.push(`Review stopped at maxRounds=${maxRounds} before convergence`);
  log(`Stopped at maxRounds=${maxRounds}; review is incomplete`);
}
return { confirmed, rejected, unverified: unverifiedClaims(), critique, rounds, stoppedAfterDryRounds: converged, unresolvedGaps: gaps,
  status: converged ? 'complete' : 'incomplete', stopReason: budgetExhausted ? 'budget' : capped ? 'maxRounds' : converged ? 'dryRounds' : 'unresolvedCoverage' };
