# Install Autocode

Autocode needs Node.js 20 or newer and authentication for whichever provider you use. The pinned native SDK dependencies are in `package-lock.json`.
The SSH clone command below uses your GitHub SSH key. Your account needs access while the repository remains private.

## Clone and install

```bash
git clone git@github.com:postfix/autocode.git ~/.local/share/autocode
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

If either `autocode` skill path already exists, inspect it and replace or move it deliberately before creating the link. Start a new Codex or Claude session to load the skill. In Codex, invoke it with `$autocode` followed by your task; in Claude, ask it to use the `autocode` skill. Codex and Claude can each author a workflow; `--provider` and per-call `provider` choose who executes its agent tasks.

## Check the installation

```bash
cd ~/.local/share/autocode
npm run coverage
```

Then ask Codex to exercise the installed skill:

```text
$autocode Create and run a read-only workflow that asks one Codex agent to return exactly OK, then report its result and failures.
```

That live check consumes tokens. To check the runner directly from the checkout, use:

```bash
node scripts/autocode.mjs run assets/templates/parallel-scout.js \
  --provider codex --args '{"questions":["Return exactly OK"]}'
```

For a test without a provider call, `npm test` runs the local suite with SDK fakes.
