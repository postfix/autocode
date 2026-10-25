# Install Autocode

Autocode needs Node.js 20 or newer and authentication for whichever provider you use.

## Install the npm package

After the stable `v0.1.0` npm release, install the package globally, then link its skill files into both hosts:

```bash
npm install -g autocode-skill
AUTOCODE_DIR="$(npm root -g)/autocode-skill"
mkdir -p ~/.codex/skills ~/.claude/skills
ln -s "$AUTOCODE_DIR" ~/.codex/skills/autocode
ln -s "$AUTOCODE_DIR" ~/.claude/skills/autocode
```

The npm install provides the `autocode` command and both native SDK dependencies. The links make `SKILL.md` discoverable to Codex and Claude. If either skill path already exists, inspect it and move or replace it deliberately before creating the link; keep backups outside the `skills` directories so they are not discovered as duplicate skills.

## Install from a checkout

The GitHub repository currently requires access and an authorized SSH key. The pinned SDK dependencies are in `package-lock.json`.

```bash
git clone git@github.com:postfix/autocode.git ~/.local/share/autocode
cd ~/.local/share/autocode
npm ci
npm test
```

Point both hosts at the same checkout:

```bash
mkdir -p ~/.codex/skills ~/.claude/skills
ln -s ~/.local/share/autocode ~/.codex/skills/autocode
ln -s ~/.local/share/autocode ~/.claude/skills/autocode
```

Start a new Codex or Claude session to load the skill. In Codex, invoke it with `$autocode` followed by your task; in Claude, ask it to use the `autocode` skill. Codex and Claude can each author a workflow; `--provider` and per-call `provider` choose who executes its agent tasks.

## Check the installation

For a checkout, run `npm test` in the checkout. For an npm installation, run `command -v autocode` and confirm both `~/.codex/skills/autocode/SKILL.md` and `~/.claude/skills/autocode/SKILL.md` exist.

Then ask Codex to exercise the installed skill:

```text
$autocode Create and run a read-only workflow that asks one Codex agent to return exactly OK, then report its result and failures.
```

That live check consumes tokens. To check the runner directly from a checkout, use:

```bash
node scripts/autocode.mjs run assets/templates/parallel-scout.js \
  --provider codex --args '{"questions":["Return exactly OK"]}'
```

For a test without a provider call, the checkout's `npm test` runs the local suite with SDK fakes.
