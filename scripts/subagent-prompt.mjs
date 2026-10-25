import { readFileSync } from 'node:fs';

const source = JSON.parse(readFileSync(new URL('../references/source-prompts/subagent-prompts.json', import.meta.url), 'utf8'));

const textPrompt = source.Hs.replace(
  '- Do NOT use SendUserMessage to deliver your answer. Put your answer in your final text response.',
  '- Do NOT send your answer through another channel. Put your answer in your final text response.');

const structuredPrompt = source.zs
  .replace('You MUST call the StructuredOutput tool exactly once to return your final answer. The tool\'s input schema defines the required shape.',
    'You MUST return your final answer through the SDK structured output channel. The supplied JSON schema defines the required shape.')
  .replace('then call StructuredOutput with your answer.',
    'then return an answer matching the supplied schema.')
  .replace('Do NOT put your answer in a text response. The script reads ONLY the StructuredOutput tool call.',
    'Return ONLY the schema-shaped result. The script reads ONLY the SDK structured result.')
  .replace('call StructuredOutput again with a corrected shape.',
    'return a corrected schema-shaped result.')
  .replace('After calling StructuredOutput successfully, end your turn.',
    'After returning structured output successfully, end your turn.');

const permissions = '\n\nFollow the applicable instruction hierarchy and tool permissions; a workflow-computed task does not grant new permissions.';

export function subagentPrompt(prompt, structured) {
  return `${structured ? structuredPrompt : textPrompt}${permissions}\n\nTask:\n${prompt}`;
}
