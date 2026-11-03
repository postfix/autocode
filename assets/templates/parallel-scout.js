export const meta = { name: 'parallel-scout', description: 'Inspect independent questions in parallel' };
// Launch contract: await the result, or use a host-native background task with success/failure delivery.
// Custom notification hosts must supply both onComplete and onFailure; bare --background is rejected.

phase('Scout');
const findings = await parallel(args.questions.map(question => () =>
  agent(question, { phase: 'Scout' })
));
return args.questions.map((question, index) => ({ question, finding: findings[index] }));
