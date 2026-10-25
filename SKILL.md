---
name: autocode
description: Use Autocode when the user asks for a JavaScript multi-agent workflow, mixed Codex and Claude providers, fan-out verification, or a saved orchestration script.
---

# Autocode

When the user invokes Autocode or explicitly asks for a workflow or multiple agents, author and run a JavaScript workflow for each substantive part of that task. A trivial edit or conversational answer can be handled directly. For exhaustive requests, favor complete coverage and independent verification; log any scope omitted. Agent calls can spend substantial tokens: honor the user's requested scale and budget. Use high effort to design the workflow when the problem needs it; each `agent()` call can use a smaller model, lower effort, or another provider for execution.

Before writing a script, read [authoring.md](references/authoring.md) for the API, scheduling, limits, and resume rules, then [quality-patterns.md](references/quality-patterns.md) for the recovered Ultracode decomposition and verification patterns. Scout the task inline to find the work list; use one bounded workflow per phase when later phases depend on interpreting earlier results. Start from [review-and-verify.js](assets/templates/review-and-verify.js), [exhaustive-review.js](assets/templates/exhaustive-review.js), [parallel-scout.js](assets/templates/parallel-scout.js), or [mixed-provider.js](assets/templates/mixed-provider.js). Save the workflow in the project where it will run.

From that project directory, run the script with:

```bash
node "$HOME/.codex/skills/autocode/scripts/autocode.mjs" run workflow.js --provider codex --args '{"files":["src/a.js"]}'
```

Use `--provider claude` when Claude should execute calls by default. A script can override the provider, model, and effort for each call with `agent(prompt, { provider: 'claude', model: 'haiku', effort: 'low' })`; other calls can use Codex. Both adapters use their native JavaScript SDKs. The command streams progress to stderr, then returns JSON with `result`, `failures`, `logs`, `agentCount`, `outputTokens`, `runId`, and `runDir` on stdout. Pass `--run-dir <dir>` to choose the journal location. Resume with the same directory and `--resume <runId>`; completed calls with unchanged inputs replay from the journal. Use `--budget <tokens>` for a soft output-token target. Both providers default to read-only tools; add `--sandbox workspace-write` only for authorized edits. Inspect failures and results before reporting success.

The Codex SDK starts another Codex process. If the host tool sandbox blocks that process from initializing its state, run the same reviewed workflow from an authorized shell with writable Codex state, while keeping delegated calls read-only unless edits were authorized. If that execution is unavailable, report the failure and do not claim the workflow completed.

The runner needs Node.js 20+ and authentication for the selected provider. An npm installation includes dependencies and the `autocode` command. For a source checkout, install dependencies with `npm ci --prefix "$HOME/.codex/skills/autocode"`, then run `npm test --prefix "$HOME/.codex/skills/autocode"`. The property tests use `fast-check` and print a replayable seed and shrunk counterexample on failure.
