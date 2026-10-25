# Autocode

Autocode runs JavaScript workflows that coordinate local Codex and Claude agents. A workflow can fan out tasks, run pipelines, call child workflows, report progress, enforce a soft output-token budget, and resume completed agent calls from its journal. The runner uses the native `@openai/codex-sdk` and `@anthropic-ai/claude-agent-sdk` packages.

The agent authoring a workflow can use a capable model and high effort. Each delegated `agent()` call can then choose a smaller model, lower effort, or a different provider.

## Quick start

See [INSTALL.md](INSTALL.md) for prerequisites and skill setup. From a checkout with dependencies installed:

```bash
node scripts/autocode.mjs run assets/templates/parallel-scout.js \
  --provider codex \
  --args '{"questions":["Find likely bugs in src/","Check the README examples"]}'
```

The command prints progress to stderr and a JSON result to stdout. [USAGE.md](USAGE.md) explains the workflow API, mixed-provider calls, resume, limits, and permission modes. The [mixed-provider template](assets/templates/mixed-provider.js) demonstrates provider, model, and effort selection per task.

## What has been tested

The package has **43 named test cases across seven passing test files**, including three property tests with 140 generated cases. A clean `npm ci` install and the local suite passed. The tests cover the runner, adapters through native SDK API fakes, command routing, templates, and resume. One live read-only Codex SDK call returned `CODEX_NATIVE_OK`.

**Still untested live on the current Codex SDK path:** structured output, multiple concurrent Codex calls, resume after a Codex SDK call, workspace-write behavior, and model switching. Those paths have local tests using SDK fakes or runner fakes, which do not establish live Codex behavior. The mixed live run started Claude through its SDK, but the account returned a weekly usage-limit error; no successful live Claude SDK result has been verified.

The project does not claim complete Ultracode parity or 100% branch coverage. `npm run coverage` measured **100% lines, 77.68% branches, and 97.67% functions** in this package.

## Scope and provenance

Autocode is an independent implementation of local workflow orchestration. This repository contains its own code, templates, tests, and authored guidance. Extracted third-party bundle modules and verbatim prompt assets are not included.

Run only workflow scripts you trust. Node's VM provides workflow globals but is not a security boundary. The SDKs may start their own local runtimes internally; Autocode calls their programmatic APIs rather than constructing `codex exec` or `claude -p` commands.
