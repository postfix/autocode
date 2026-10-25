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

The npm package is named `autocode-skill` because `autocode` is already occupied on npm. The package installs an `autocode` command and includes the skill files; [release instructions](RELEASING.md) cover the initial MFA bootstrap and subsequent GitHub Trusted Publishing.

## What has been tested

The package's local suite covers the runner, adapters through native SDK API fakes, command routing, templates, resume, release validation, and npm tarball contents. A local install of the 0.1.0 tarball ran the packaged `autocode` command and returned `PACKAGED_OK`. One live read-only Codex SDK call returned `CODEX_NATIVE_OK`, and a live two-agent parallel release review completed through the SDK. A live Codex skill-authoring eval followed by a separate three-agent structured workflow passed, and a direct live text-agent check returned `TEXT_PROMPT_OK`. A fresh installed Claude skill invocation remains unverified.

**Still untested live on the current Codex SDK path:** resume after a Codex SDK call, workspace-write behavior, and model switching. Those paths have local tests using SDK fakes or runner fakes, which do not establish live Codex behavior. Structured output succeeded in the three-agent live eval. The mixed live run started Claude through its SDK, but the account returned a weekly usage-limit error; no successful live Claude SDK result has been verified.

The [live skill eval](evals/README.md) checks `$autocode` authoring and a separately launched three-agent Codex workflow. It found a strict structured-output schema bug; after the fix, the skill-authoring and direct-run checks passed. An integrated nested SDK run inside a sandboxed Codex host still failed to initialize Codex state. See the [eval results](evals/RESULTS.md), [Ultracode parity report](docs/ULTRACODE-PARITY.md), and [recovered prose comparison](docs/PROSE-DIFF.md) for the exact boundary.

The project does not claim complete Ultracode parity or 100% branch coverage. Run `npm run coverage` for the current measurements; the 0.1.1 candidate measured **93.12% lines, 78.34% branches, and 89.66% functions** across runtime, adapters, and hooks. The restored prompt module itself measured 100% in all three metrics.

## Scope and provenance

Autocode is an independent implementation of local workflow orchestration, released under [Apache-2.0](LICENSE). This 0.1.1 candidate contains its own runner, templates, and tests, plus [recovered Ultracode prompt assets](references/source-prompts/) for instruction parity. The original subagent text and structured prompts are loaded at runtime with substitutions for unavailable SDK tools. Extracted bundle modules are not included. The current npm `latest` release does not contain these candidate changes.

Run only workflow scripts you trust. Node's VM provides workflow globals but is not a security boundary. The SDKs may start their own local runtimes internally; Autocode calls their programmatic APIs rather than constructing `codex exec` or `claude -p` commands.
