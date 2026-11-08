# Install Autocode

Autocode needs Node.js 20 or newer and authentication for whichever provider you use.

## Install the command

Install the runner and its SDK dependencies globally:

```bash
npm install -g autocode-skill
```

This provides the `autocode` command. The host plugins below provide the skill and its session hooks. If your npm global bin directory is not on `PATH`, add that directory to `PATH` so the skill can run `autocode`.

## Install the skill and session hooks

Install the Autocode plugin from the public repository. It supplies the skill and the one-turn `autocode` keyword hook plus persistent `autocode on` / `autocode off` reminders. Use the plugin installation as the single skill installation; remove any older `~/.codex/skills/autocode` or `~/.claude/skills/autocode` symlink after checking where it points.

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

Start a new Claude session after installation. Plain `autocode` in a human request opts that turn into a workflow; `autocode on` enables standing mode for substantive tasks until `autocode off`. The plugin stores per-session mode state; npm installation by itself does not register the skill or hooks.

## Install from a checkout

The GitHub repository is public. The pinned SDK dependencies are in `package-lock.json`.

```bash
git clone https://github.com/postfix/autocode.git ~/.local/share/autocode
cd ~/.local/share/autocode
npm ci
npm test
```

Then install the runner and the skill for the hosts you choose:

```bash
node scripts/autocode.mjs install --target codex
# or: --target claude | --target omp | --target codex,claude | --target all
```

With no `--target` in a terminal, it prompts for the host(s). The installer links the `autocode` runner into `~/.local/bin` (re-run after pulling a new checkout) and links the skill into each selected host's discovery directory:

- Codex → `~/.codex/skills/autocode`
- Claude → `~/.claude/skills/autocode`
- Oh My Pi → `~/.omp/agent/skills/autocode`

Start a new Codex, Claude, or OMP session to load the skill. Codex, Claude, and OMP can each author a workflow; `--provider` and per-call `provider` choose who executes its agent tasks. `autocode install --status` reports each installed target and whether it is up to date.

The `autocode` keyword and `autocode on` / `autocode off` session hooks are supplied by the plugin (marketplace) install for Codex and Claude, not by the skill symlink. The npm package also carries `plugin.json` (portable Agent Plugins manifest) and `skills/autocode/SKILL.md`, so OMP can install it via `omp plugin link <checkout>` or a marketplace as a portable plugin.

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
