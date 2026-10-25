---
name: autocode
description: Build and run JavaScript multi-agent workflows when the user requests Autocode, parallel agents, fan-out verification, or a saved workflow.
---

# Autocode

Deliver the workflow's verified result when the user invokes Autocode or asks for multi-agent orchestration. Handle a conversational answer or trivial edit directly. For an exhaustive request, cover the discovered work list, verify findings independently, and log any omitted scope. Agent calls can spend substantial tokens; follow the user's scale and budget. The authoring agent can use high effort while each delegated `agent()` call uses a smaller model, lower effort, or another provider when that fits its task.

When the optional Autocode plugin supplies a keyword or session-mode reminder, treat it as the user's workflow opt-in. In standing mode, author and run a workflow for every substantive task; use solo work for conversation and trivial edits. `autocode off` returns to explicit opt-in.

## Author

Read the [recovered Ultracode authoring reference](references/source-prompts/authoring.md) for its full decomposition, verification, and worked-example prose. Read [authoring.md](references/authoring.md) for the Autocode API and differences: use the saved script and CLI command below where the recovered reference says to call Claude's `Workflow` tool; use SDK structured output where it names `StructuredOutput`; use the runner's soft output-token budget and documented limits. Read [quality-patterns.md](references/quality-patterns.md) for runnable Autocode examples. Inspect the target first to make the work list. Use `pipeline()` by default when each item can advance independently; use a `parallel()` barrier when the next stage needs all prior results. For multi-phase tasks, inspect each phase's result before authoring the next workflow when the next step requires a new judgment.

Choose a runnable starting point and supply its required `args`:

- [review-and-verify.js](assets/templates/review-and-verify.js): `{ "topics": ["src/a.js"] }`.
- [exhaustive-review.js](assets/templates/exhaustive-review.js): `{ "topics": ["src/a.js"], "maxRounds": 4 }`.
- [parallel-scout.js](assets/templates/parallel-scout.js): `{ "questions": ["Inspect src/a.js"] }`.
- [mixed-provider.js](assets/templates/mixed-provider.js): `{ "tasks": [{ "question": "Inspect src/a.js", "provider": "codex" }] }`.

Save the script in the project where it will run. It is ready to run when its literal `meta` has a name and description, its `args` match the chosen template or script, and it returns a JSON-serializable result.

## Run

From that project directory, run the script with:

```bash
autocode run workflow.js --provider codex --args '{"files":["src/a.js"]}'
```

Use `--provider claude` when Claude should execute calls by default. Set a provider, model, and effort for a specific call with `agent(prompt, { provider: 'claude', model: 'haiku', effort: 'low' })`. Both adapters use native JavaScript SDKs. Progress streams to stderr; stdout contains JSON with `result`, `failures`, `logs`, `agentCount`, `outputTokens`, `runId`, and `runDir`. Pass `--run-dir <dir>` to choose a journal location. Resume the same script and directory with `--resume <runId>`; completed calls with unchanged inputs replay from the journal. Use `--budget <tokens>` for a soft output-token target. Delegated agents default to read-only tools; set `--sandbox workspace-write` when the user authorized edits.

## Check the result

Read the returned `result` and `failures` before answering the user. The task is complete when the result satisfies the requested work and each claimed finding has the requested evidence or verification. Report failed branches, unreadable sources, and any omitted scope. If a run fails, inspect `journal.jsonl` in its `runDir` before retrying or resuming.

The Codex SDK starts another Codex process. If the host tool sandbox reports `Read-only file system` while that process initializes, rerun the same reviewed script from a permitted shell that can write Codex state; keep delegated calls read-only unless edits were authorized. If no such execution is available, report the failed run.

The runner needs Node.js 20+, the globally installed `autocode-skill` npm package, and authentication for the selected provider. `npm install -g autocode-skill` provides its dependencies and the `autocode` command. A passing `npm test` in a source checkout checks the local runner and templates; the task's workflow result still needs inspection.
