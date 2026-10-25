---
name: autocode
description: Build and run JavaScript workflows across Codex and Claude agents with parallel tasks, pipelines, progress, token budgets, and resumable results. Use when the user asks for Autocode, a multi-agent workflow, mixed providers, fan-out verification, or a saved orchestration script.
---

# Autocode

Author a bounded JavaScript workflow, then run it with Codex, Claude, or both. Use a workflow when the user requests multi-agent orchestration or invokes this skill; agent calls can spend substantial tokens. Plan the task list and expected result before launching. The host agent that writes the workflow can use high effort for design; each `agent()` call can specify a smaller model and lower effort for execution.

Read [authoring.md](references/authoring.md) when writing a script. Start from [review-and-verify.js](assets/templates/review-and-verify.js) for independent reviews followed by verification, [parallel-scout.js](assets/templates/parallel-scout.js) for a one-stage sweep, or [mixed-provider.js](assets/templates/mixed-provider.js) to choose provider and model per task.

Run the script with:

```bash
node <this-skill-directory>/scripts/autocode.mjs run <workflow.js> --provider codex --args '{"files":["src/a.js"]}'
```

Use `--provider claude` when Claude should execute calls by default. A script can override the provider, model, and effort for each call with `agent(prompt, { provider: 'claude', model: 'haiku', effort: 'low' })`; other calls can use Codex. Both adapters use their native JavaScript SDKs. The command streams progress to stderr, then returns JSON with `result`, `failures`, `logs`, `agentCount`, `outputTokens`, `runId`, and `runDir` on stdout. Pass `--run-dir <dir>` to choose the journal location. Resume with the same directory and `--resume <runId>`; completed calls with unchanged inputs replay from the journal. Use `--budget <tokens>` for a soft output-token target. Both providers default to read-only tools; add `--sandbox workspace-write` only for authorized edits. Inspect failures and results before reporting success.

The runner needs Node.js 20+ and authentication for the selected provider. Install dependencies with `npm ci --prefix <this-skill-directory>`, then run `node --test --experimental-test-coverage <this-skill-directory>/tests/*.test.mjs`. The property tests use `fast-check` and print a replayable seed and shrunk counterexample on failure.
