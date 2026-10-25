export const meta = {
  name: 'exhaustive-review',
  description: 'Discover fresh findings, check them from three angles, and critique coverage',
  phases: [{ title: 'Find' }, { title: 'Verify' }, { title: 'Completeness' }],
};

const seen = new Set();
const confirmed = [];
let dry = 0;
let rounds = 0;
const maxRounds = args.maxRounds ?? 4;
const findingsSchema = {
  type: 'object', properties: { findings: { type: 'array', items: { type: 'string' } } }, required: ['findings'],
};
const verdictSchema = {
  type: 'object', properties: { real: { type: 'boolean' }, reason: { type: 'string' } }, required: ['real', 'reason'],
};

while (dry < 2 && rounds < maxRounds) {
  rounds++;
  const scans = await parallel(args.topics.map(topic => () =>
    agent(`Round ${rounds}: find new, concrete issues in ${topic}. Return findings as strings.`,
      { phase: 'Find', schema: findingsSchema })));
  const fresh = scans.filter(Boolean).flatMap(scan => scan.findings).filter(finding => {
    if (seen.has(finding)) return false;
    seen.add(finding);
    return true;
  });
  log(`Round ${rounds}: ${fresh.length} new findings`);
  if (!fresh.length) { dry++; continue; }
  dry = 0;
  const judged = await parallel(fresh.map(finding => () =>
    parallel(['correctness', 'security', 'reproducibility'].map(lens => () =>
      agent(`Try to refute this finding through ${lens}: ${finding}. Return real=true only if it survives.`,
        { phase: 'Verify', schema: verdictSchema })))
      .then(votes => ({ finding, votes }))));
  for (const item of judged.filter(Boolean))
    if (item.votes.filter(vote => vote?.real === true).length >= 2)
      confirmed.push(item.finding);
}

if (rounds === maxRounds && dry < 2) log(`Stopped at maxRounds=${maxRounds}; discovery may be incomplete`);
const critique = await agent(
  `Check for unsearched areas, unverified claims, and unreadable sources in this review: ${JSON.stringify({ topics: args.topics, confirmed, rounds })}`,
  { phase: 'Completeness' },
);
return { confirmed, critique, rounds, stoppedAfterDryRounds: dry >= 2 };
