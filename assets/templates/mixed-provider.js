export const meta = { name: 'mixed-provider', description: 'Ask each specialist with its selected model and provider' };
phase('Delegate');
const results = await parallel(args.tasks.map(task => () => agent(task.question, {
  provider: task.provider,
  model: task.model,
  effort: task.effort,
  phase: 'Delegate',
  label: task.label ?? task.question,
})));
return args.tasks.map((task, index) => ({ label: task.label ?? task.question, result: results[index] }));
