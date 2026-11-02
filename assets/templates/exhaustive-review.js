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
if (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > 1000) throw new TypeError('maxRounds must be an integer from 1 to 1000');
const findingsSchema = {
  type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, line: { type: 'integer', minimum: 1 }, description: { type: 'string' } }, required: ['file', 'line', 'description'], additionalProperties: false } } }, required: ['findings'],
};
const verdictSchema = {
  type: 'object', properties: { real: { type: 'boolean' }, reason: { type: 'string' } }, required: ['real', 'reason'],
};

let critique, gaps = [];
for (;;) {
while (dry < 2 && rounds < maxRounds) {
  rounds++;
  const scans = await parallel(args.topics.map(topic => () =>
    agent(`Round ${rounds}: find new, concrete issues in ${topic}. Return structured findings with file, line, and description. Close these coverage gaps within the assigned topic: ${JSON.stringify(gaps)}.`,
      { phase: 'Find', schema: findingsSchema })));
  const fresh = scans.filter(Boolean).flatMap(scan => scan.findings).filter(finding => {
    const key = JSON.stringify([finding.file, finding.line, finding.description]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  log(`Round ${rounds}: ${fresh.length} new findings`);
  if (!fresh.length) { dry++; continue; }
  dry = 0;
  const judged = await parallel(fresh.map(finding => () =>
    parallel(['correctness', 'security', 'reproducibility'].map(lens => () =>
      agent(`Try to refute this finding through ${lens}: ${JSON.stringify(finding)}. Return real=true only if it survives. Default to real=false if uncertain. Cite concrete evidence in reason.`,
        { phase: 'Verify', schema: verdictSchema })))
      .then(votes => ({ finding, votes }))));
  for (const item of judged.filter(Boolean))
    if (item.votes.filter(vote => vote?.real === true).length >= 2)
      confirmed.push(item.finding);
}

  const review = await agent(
    `Check for unsearched areas, unverified claims, and unreadable sources in this review: ${JSON.stringify({ topics: args.topics, confirmed, rounds })}. Return concrete gaps that can be investigated within the assigned topics.`,
    { phase: 'Completeness', schema: { type: 'object', properties: { summary: { type: 'string' }, gaps: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'gaps'] } },
  );
  critique = typeof review === 'string' ? review : review?.summary;
  gaps = review === null ? ['Completeness check did not return a validated verdict'] : review?.gaps ?? [];
  if (!gaps.length || rounds >= maxRounds) break;
  dry = 0;
}
if (rounds === maxRounds && (dry < 2 || gaps.length)) log(`Stopped at maxRounds=${maxRounds}; discovery may be incomplete`);
return { confirmed, critique, rounds, stoppedAfterDryRounds: dry >= 2 && !gaps.length, unresolvedGaps: gaps };
