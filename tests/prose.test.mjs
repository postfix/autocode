import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const originals = {
  'activation-reminders.json': '76cec4df8fd521382b246341041bbd31a692d079e41752e24e86246ae9c47d06',
  'authoring-forced-model.md': '93cc9fa6dc7e0d55ec6eb76104b5bbb0fa54cfee1e2e91e92c8c649ec84a5948',
  'authoring-preamble.txt': 'e1b6cd5069a2008a6724797064e1fb2c29aeceea1b11fb187979559dd74509d3',
  'authoring.md': '41a4cb3a2cb3416dea7329024ea30a68cd653deee56106e3fbe5ea8af2fb0dd8',
  'prose-fragments.md': '0ad0bfbe1d8ae915c89d668be488db2de47c2eabac403b54bc75ca7aafc9c0ac',
  'subagent-prompts.json': '5f25813a853feb0f04ec2c4f605af744a2864c4d7fea8bf759edf5acb12a2b02',
  'workflow-tool-alternate.md': '1cc05470f275ca6995e628a9b88c52eb4c6e53c53654996f9b8a1227ab0aecf4',
  'workflow-tool.md': 'db6e28ae17cf79304251e74fe3e64e8b69930e5982c555223de327239ac871c6',
};

test('all packaged recovered prompt assets remain byte-identical to the recovery inventory', async () => {
  for (const [name, expected] of Object.entries(originals)) {
    const bytes = await readFile(join(root, 'references/source-prompts', name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, name);
  }
  const skill = await readFile(join(root, 'SKILL.md'), 'utf8');
  assert.match(skill, /references\/source-prompts\/authoring\.md/);
  assert.match(skill, /references\/authoring\.md/);
});
