export const meta = { name: 'mixed-provider', description: 'Ask each specialist with its selected model and provider' };
// Launch contract: await the result, or use a host-native background task with success/failure delivery.
// Custom notification hosts must supply both onComplete and onFailure; bare --background is rejected.

phase('Delegate');
const results = await parallel(args.tasks.map(task => () => agent(task.question, {
  provider: task.provider,
  model: task.model,
  effort: task.effort,
  phase: 'Delegate',
  label: task.label ?? task.question,
})));
return args.tasks.map((task, index) => ({ label: task.label ?? task.question, result: results[index] }));
