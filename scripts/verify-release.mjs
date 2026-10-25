import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const required = new Set([
  'package.json', 'LICENSE', 'README.md', 'INSTALL.md', 'USAGE.md', 'SKILL.md',
  'docs/PROSE-DIFF.md', 'hooks/autocode-mode.cjs', 'hooks/claude-codex-hooks.json',
  '.codex-plugin/plugin.json', '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json',
  'agents/openai.yaml', 'references/authoring.md', 'references/quality-patterns.md',
  'references/source-prompts/authoring.md',
  'references/source-prompts/authoring-forced-model.md',
  'references/source-prompts/workflow-tool.md',
  'references/source-prompts/workflow-tool-alternate.md',
  'references/source-prompts/authoring-preamble.txt',
  'references/source-prompts/activation-reminders.json',
  'references/source-prompts/subagent-prompts.json',
  'references/source-prompts/prose-fragments.md',
  'assets/templates/parallel-scout.js', 'assets/templates/review-and-verify.js',
  'assets/templates/exhaustive-review.js', 'assets/templates/mixed-provider.js', 'scripts/autocode.mjs',
  'scripts/claude-adapter.mjs', 'scripts/codex-adapter.mjs', 'scripts/runtime.mjs',
  'scripts/subagent-prompt.mjs',
]);

export function verifyRelease(tag, manifest, lock, pack) {
  if (tag !== `v${manifest.version}`) throw new Error('release tag does not match package version');
  if (lock.name !== manifest.name || lock.version !== manifest.version ||
      lock.packages?.['']?.name !== manifest.name ||
      lock.packages?.['']?.version !== manifest.version)
    throw new Error('package-lockfile does not match package version');
  if (pack.name !== manifest.name || pack.version !== manifest.version || !Array.isArray(pack.files))
    throw new Error('npm pack metadata does not match package version');
  const packed = new Set(pack.files.map(file => file.path));
  for (const path of required) if (!packed.has(path)) throw new Error(`missing npm package file: ${path}`);
  for (const path of packed) if (!required.has(path)) throw new Error(`unexpected npm package file: ${path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const [pack] = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  verifyRelease(process.argv[2], manifest, lock, pack);
  process.stdout.write(`Verified ${pack.name}@${pack.version}\n`);
}
