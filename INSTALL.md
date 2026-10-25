# Install Autocode

Autocode needs Node.js 20 or newer and authentication for whichever provider you use.

## Install the command

Install the runner and its SDK dependencies globally:

```bash
npm install -g autocode-skill
```

This provides the `autocode` command. The host plugins below provide the skill and its session hooks. If your npm global bin directory is not on `PATH`, add that directory to `PATH` so the skill can run `autocode`.

## Install the skill and session hooks

Install the Autocode plugin from the public repository. It supplies the skill and the one-turn `ultracode` keyword hook plus persistent `autocode on` / `autocode off` reminders. Use the plugin installation as the single skill installation; remove any older `~/.codex/skills/autocode` or `~/.claude/skills/autocode` symlink after checking where it points.

Codex CLI:

```bash
codex plugin marketplace add postfix/autocode
codex plugin add autocode@autocode
```

In Codex, open `/hooks`, trust the Autocode lifecycle hooks, and start a new thread. In Claude Code, run:

```text
/plugin marketplace add postfix/autocode
/plugin install autocode@autocode
```

Start a new Claude session after installation. Plain `ultracode` in a human request opts that turn into a workflow; `autocode on` or `ultracode on` enables standing mode for substantive tasks until `autocode off` or `ultracode off`. The plugin stores per-session mode state; npm installation by itself does not register the skill or hooks.

## Install from a checkout

The GitHub repository is public. The pinned SDK dependencies are in `package-lock.json`.

```bash
git clone https://github.com/postfix/autocode.git ~/.local/share/autocode
cd ~/.local/share/autocode
npm ci
npm test
```

For a skill-only checkout without plugin hooks, point both hosts at the same checkout:

```bash
mkdir -p ~/.codex/skills ~/.claude/skills
ln -s ~/.local/share/autocode ~/.codex/skills/autocode
ln -s ~/.local/share/autocode ~/.claude/skills/autocode
```

Start a new Codex or Claude session to load the skill. In Codex, invoke it with `$autocode` followed by your task; in Claude, ask it to use the `autocode` skill. Codex and Claude can each author a workflow; `--provider` and per-call `provider` choose who executes its agent tasks.

## Check the installation

For a checkout, run `npm test` in the checkout. For an npm and plugin installation, run `command -v autocode`, `codex plugin list`, and `claude plugin details autocode@autocode`. Each host should show one active Autocode skill.

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
