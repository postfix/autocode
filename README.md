# Autocode

Autocode is a skill for Codex and Claude that writes and runs JavaScript workflows to coordinate agents. A workflow can fan out tasks, run pipelines, call child workflows, report progress, enforce a soft output-token budget, and resume completed agent calls from its journal. The runner uses the native `@openai/codex-sdk` and `@anthropic-ai/claude-agent-sdk` packages.

The agent authoring a workflow can use a capable model and high effort. Each delegated `agent()` call can then choose a smaller model, lower effort, or a different provider.

## Quick start

Follow [INSTALL.md](INSTALL.md) to install the skill from npm or a checkout. Then ask Codex:

```text
$autocode Review the changes in this repository with parallel agents, independently verify each finding, and report the evidence.
```

In Claude, ask it to use the `autocode` skill with the same request. The skill writes a workflow for the task, runs it through the local SDK adapters, and reports the results and failures. Ask for a specific provider, model, or effort level when you want to control delegated calls; the authoring agent can use higher effort than the agents that execute the workflow.

The [host plugin](INSTALL.md#install-the-skill-and-session-hooks) installs the skill plus a one-turn `ultracode` keyword trigger and `autocode on` / `autocode off` session reminders in Codex and Claude. The npm package installs the runner command and SDK dependencies; Codex requires hook trust for the plugin.

## Run a workflow directly

To run a bundled template from a checkout with dependencies installed:

```bash
node scripts/autocode.mjs run assets/templates/parallel-scout.js \
  --provider codex \
  --args '{"questions":["Find likely bugs in src/","Check the README examples"]}'
```

The command prints progress to stderr and a JSON result to stdout. [USAGE.md](USAGE.md) explains skill use, the workflow API, mixed-provider calls, resume, limits, and permission modes. The [quality patterns](references/quality-patterns.md) preserve the recovered Ultracode workflow decisions and worked examples in Autocode's API. The [exhaustive review template](assets/templates/exhaustive-review.js) runs repeated discovery, skeptical verification, and a completeness check.

Inspect and control a CLI run from another terminal:

```bash
autocode ps
autocode status [id]
autocode pause [id]
autocode resume [id]
autocode cancel [id]
```

Commands find workflows in the current project, including runs with custom journal locations. Omit the optional ID when only one workflow is active; with several, choose from the displayed list. `ps` lists active and paused workflows. Status shows phases, agents, reported usage and errors, including failed tools within successful agents. Linux live controls pause/resume the actual program or terminate its owned process tree. See [control semantics and limits](USAGE.md#inspect-and-control-a-running-program).

The npm package is named `autocode-skill` because `autocode` is already occupied on npm. The package installs an `autocode` command and includes the skill files; [release instructions](RELEASING.md) cover the initial MFA bootstrap and subsequent GitHub Trusted Publishing.

## What has been tested

The unreleased working tree adds versioned replay, literal metadata validation, reported failed-call usage, shared host budgets, worktree isolation, higher-priority subagent instructions, trusted custom agents, structured-result validation/repair, background launch and individual agent controls. See [USAGE.md](USAGE.md) for the current interfaces and the [40-requirement status matrix](docs/PARITY-STATUS.json) for remaining work.

Live checks on 2026-11-02 passed text and structured output on both providers, local MCP fixture execution on both providers, authorized writes in isolated worktrees on both providers, Codex optional-field transport, and a narrowly authorized Claude Bash command. These replace the earlier account-limited Claude checks; a real nested Codex parent → CLI → SDK run, tagged object-union output, and live replay/changed-effort checks also passed. The current skill also passed real authoring and CLI execution from a disposable Codex home. Exact host UI integration and complete equivalence to the source native tool pool are outside the agreed scope. [Live evidence](evals/live-parity-2026-11-02.json) and [TDD evidence](evals/parity-tdd.log) distinguish exercised behavior from remaining work.

Run the Linux suite with `node --test tests/*.test.mjs` in an environment allowing local sockets and process signals. Restricted-shell failures are not passing controls. The user selected optional provider restrictions: retain implemented native controls and exclude unsupported provider-specific policies. Ordinary runs are available without those optional policies; requesting an unsupported restriction fails explicitly. No engine fork or Factory executor project is planned. This scoped target does not claim full parity with all 40 original requirements; the [capability scope decision](docs/REMAINING-PARITY-BACKEND.md) and status matrix identify the exclusions. No parity release has been published.

## Scope and provenance

Autocode is an independent implementation of local workflow orchestration, released under [Apache-2.0](LICENSE). This 0.1.1 candidate contains its own runner, templates, and tests, plus [recovered Ultracode prompt assets](references/source-prompts/) for instruction parity. The original subagent text and structured prompts are loaded at runtime with substitutions for unavailable SDK tools. Extracted bundle modules are not included. The current npm `latest` release does not contain these candidate changes.

Run only workflow scripts you trust. Node's VM provides workflow globals but is not a security boundary. The SDKs may start their own local runtimes internally; Autocode calls their programmatic APIs rather than constructing `codex exec` or `claude -p` commands.

The [full integrated evaluation](evals/RESULTS.md) ran the current skill through authoring, actual CLI execution, parallel review and skeptical verification on `gpt-6-luna` and `claude-haiku-5-5`. Both reported all four fixture defects with valid executable counterexamples and no false positives. The actual native Codex run passed without MCP using normal command approvals; the report preserves the earlier restricted SDK-parent failure and MCP experiment separately.
