export const meta = {
  name: 'review-and-verify',
  description: 'Review independent topics and verify each finding',
  phases: [{ title: 'Review' }, { title: 'Verify' }],
};
// Launch contract: await the result, or use a host-native background task with success/failure delivery.
// Custom notification hosts must supply both onComplete and onFailure; bare --background is rejected.

phase('Review');
const checked = await pipeline(
  args.topics,
  topic => agent(`Review ${topic} and return concrete findings with file, line, and description.`, {
    schema: { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { file: { type: 'string', minLength: 1 }, line: { type: 'integer', minimum: 1 }, description: { type: 'string', minLength: 1 } }, required: ['file', 'line', 'description'], additionalProperties: false } } }, required: ['findings'] },
    phase: 'Review',
  }),
  review => parallel(review.findings.map(finding => () =>
    agent(`Try to refute this finding: ${JSON.stringify(finding)}. Return real=true only if it survives. Default to real=false if uncertain. Cite concrete evidence in reason.`, {
      phase: 'Verify',
      schema: { type: 'object', properties: { real: { type: 'boolean' }, reason: { type: 'string', pattern: '\\S' } }, required: ['real', 'reason'] },
    })
      .then(verdict => {
        if (!verdict) log(`Unresolved verification: ${JSON.stringify(finding)}`);
        return { finding, verdict };
      })
      .catch(error => {
        log(`Unresolved verification: ${JSON.stringify(finding)}`);
        throw error;
      })
  )),
);
const completed = checked.filter(Boolean);
log(`Reviewed ${completed.length}/${args.topics.length} topics`);
if (completed.length < args.topics.length) log('Some topics did not complete; inspect failures before claiming coverage');
return completed.flat().filter(item => item?.verdict?.real === true);
