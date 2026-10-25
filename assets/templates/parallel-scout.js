export const meta = { name: 'parallel-scout', description: 'Inspect independent questions in parallel' };
phase('Scout');
const findings = await parallel(args.questions.map(question => () =>
  agent(question, { phase: 'Scout' })
));
return args.questions.map((question, index) => ({ question, finding: findings[index] }));
