export const meta = {
  name: 'review-and-verify',
  description: 'Review independent topics and verify each finding',
  phases: [{ title: 'Review' }, { title: 'Verify' }],
};
phase('Review');
const checked = await pipeline(
  args.topics,
  topic => agent(`Review ${topic} and return findings as JSON`, {
    schema: { type: 'object', properties: { findings: { type: 'array', items: { type: 'string' } } }, required: ['findings'] },
    phase: 'Review',
  }),
  review => parallel(review.findings.map(finding => () =>
    agent(`Try to refute this finding with concrete evidence: ${finding}. Return real=true only if it survives.`, {
      phase: 'Verify',
      schema: { type: 'object', properties: { real: { type: 'boolean' }, reason: { type: 'string' } }, required: ['real', 'reason'] },
    })
      .then(verdict => ({ finding, verdict }))
  )),
);
log(`Reviewed ${args.topics.length} topics`);
return checked.filter(Boolean).flat().filter(item => item?.verdict?.real === true);
