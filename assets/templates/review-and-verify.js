export const meta = { name: 'review-and-verify', description: 'Review independent topics and verify each finding' };
phase('Review');
const checked = await pipeline(
  args.topics,
  topic => agent(`Review ${topic} and return findings as JSON`, {
    schema: { type: 'object', properties: { findings: { type: 'array', items: { type: 'string' } } }, required: ['findings'] },
    phase: 'Review',
  }),
  review => parallel(review.findings.map(finding => () =>
    agent(`Independently verify this finding: ${finding}`, { phase: 'Verify' })
      .then(verdict => ({ finding, verdict }))
  )),
);
log(`Reviewed ${args.topics.length} topics`);
return checked.flat().filter(Boolean);
