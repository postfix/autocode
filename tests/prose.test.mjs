import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const originals = {
  'activation-reminders.json': 'cd9d45b2fe61d25b3137103c47883b391dc3317bb2c36d2cd35c292bb2c510cf',
  'authoring-forced-model.md': 'eab0e17e283af0bfa3824e85746df17b71f2d5e102ed3ddf9e4844b4a60b296f',
  'authoring-preamble.txt': 'c714ac80eb4c50d2c401625dcf25cf05df81a68c699bd90b7a0041e18f936b19',
  'authoring.md': 'e790838a9c85bf3bd7f7a6177c7518db99764db5eff4009c6012bd95f74134c0',
  'prose-fragments.md': '36f50507615fe88ae0fe971f4e1486a7ca6f7cb94f647bac15995f9a18c87d5f',
  'subagent-prompts.json': '5f25813a853feb0f04ec2c4f605af744a2864c4d7fea8bf759edf5acb12a2b02',
  'workflow-tool-alternate.md': '4067cd4a60b4ff990d3baada457ac3c0b0c9eab99f53eea4c6cffb3fd59f0f13',
  'workflow-tool.md': '8b885450ecf0f7792ac6ac66ff67b23fcd8381f48ea5a0794889c2ba6b16de11',
};

test('all packaged recovered prompt assets remain byte-identical to the recorded inventory', async () => {
  for (const [name, expected] of Object.entries(originals)) {
    const bytes = await readFile(join(root, 'references/source-prompts', name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, name);
  }
  const skill = await readFile(join(root, 'SKILL.md'), 'utf8');
  assert.match(skill, /references\/source-prompts\/authoring\.md/);
  assert.match(skill, /references\/authoring\.md/);
});
