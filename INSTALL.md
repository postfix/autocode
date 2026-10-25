# Install Autocode

Autocode needs Node.js 20 or newer and authentication for whichever provider you use. The pinned native SDK dependencies are in `package-lock.json`.

## Clone and install

```bash
git clone https://github.com/postfix/autocode.git ~/.local/share/autocode
cd ~/.local/share/autocode
npm ci
npm test
```

## Make the skill available

Point each host at the same checkout so both use the same code and dependency installation:

```bash
mkdir -p ~/.codex/skills ~/.claude/skills
ln -s ~/.local/share/autocode ~/.codex/skills/autocode
ln -s ~/.local/share/autocode ~/.claude/skills/autocode
```

If either `autocode` skill path already exists, inspect it and replace or move it deliberately before creating the link. Start a new Codex or Claude session to load the skill. Codex and Claude can each author a workflow; `--provider` and per-call `provider` choose who executes its agent tasks.

## Check the installation

```bash
cd ~/.local/share/autocode
npm run coverage
node scripts/autocode.mjs run assets/templates/parallel-scout.js \
  --provider codex --args '{"questions":["Return exactly OK"]}'
```

The final command makes one live Codex call and consumes tokens. For a test without a provider call, `npm test` runs the local suite with SDK fakes.
