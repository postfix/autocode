---
name: autocode
description: Orchestrate sub-agents with JavaScript workflows. Use when the user wants to fan out tasks, run pipelines, call child workflows, review with independent verification, or coordinate several agents. Author and run a workflow through the `autocode` CLI.
---

# Autocode — workflow orchestration

Autocode writes and runs JavaScript workflows that coordinate agents. A workflow can fan out tasks, run pipelines, call child workflows, report progress, enforce a soft output-token budget, and resume completed agent calls from its journal. Each `agent()` call can choose its own provider (`codex`, `claude`, or `omp`), model, and effort.

Use this skill when a task is better decomposed into several coordinated agents (parallel scouting, review-and-verify, exhaustive review, or a plan → code → test → fix → QA loop) than answered in one turn.

## Run a workflow

Workflows are plain JavaScript files that start with an Autocode metadata header. Run them with the `autocode` command:

```bash
autocode run workflow.js --provider omp --args '{"topics":["src/"]}'
```

- `--provider codex|claude|omp` chooses the default provider for delegated `agent()` calls.
- `--sandbox read-only|workspace-write` controls whether delegated agents may edit files (default `read-only`).
- `--budget <tokens>` sets a soft output-token target.
- `--run-dir <dir>` chooses the journal location; `--resume <runId>` resumes a completed run.

The command prints progress to stderr and a JSON result (`result`, `failures`, `logs`, `agentCount`, `outputTokens`, `runId`, `runDir`) to stdout.

## Workflow API

| Operation | Behavior |
| --- | --- |
| `agent(prompt, opts?)` | Runs one agent. `opts` may set `provider`, `model`, `effort`, `schema`, `label`, `phase`. A root-object JSON Schema requests structured output. |
| `parallel([() => task, ...])` | Runs branches concurrently, preserving input order. A failing branch yields `null`. |
| `pipeline(items, ...stages)` | Advances each item through stages; a `null`/failed item skips later stages. |
| `workflow(nameOrRef, childArgs?)` | Runs a saved `.codex/workflows/<name>.js` file or `{scriptPath}` (one nesting level). |
| `phase(title)`, `log(msg)` | Progress markers in the journal and stderr. |
| `budget` | `total`, `spent()`, `remaining()` for the soft output-token budget. |

## Authoring rules

- The file must start with `/* autocode {"name":"...","description":"..."} */` or `export const meta = { name, description }`.
- `Date.now`, `new Date()`, and `Math.random` are unavailable (deterministic replay); use `timer`/`cancelTimer` for delays.
- Delegated agents are read-only unless `--sandbox workspace-write` (or per-call `{ sandbox: 'workspace-write' }`) is set.
- Completion must be awaited: keep the foreground `autocode run` awaited, or use a host-native background task that delivers both success and failure. Bare `--background` is rejected.
- Structured output: pass `{ schema }`; invalid results are repaired up to three times, then the call fails.

## Loop protection

Bound any repeat-until-done loop yourself. The runner also enforces a hard backstop: at most 1000 `agent()` calls per workflow, a soft output-token budget, and a concurrency cap of 16.

```js
const maxRounds = args.maxRounds ?? 3;
for (let round = 1; round <= maxRounds; round++) {
  const t = await agent('Run the tests and report PASS/FAIL.', { schema: {
    type: 'object', properties: { verdict: { type: 'string', enum: ['PASS', 'FAIL'] } }, required: ['verdict'] } });
  if (t?.verdict === 'PASS') break;
  await agent('Fix the code so the tests pass.', { sandbox: 'workspace-write' });
}
```

## Bundled templates

`assets/templates/` ships ready-to-run workflows: `parallel-scout.js`, `review-and-verify.js`, `review-fix-loop.js`, `exhaustive-review.js`, `mixed-provider.js`.

## Inspect and control a running workflow

```bash
autocode ps
autocode status [id]
autocode pause [id]
autocode resume [id]
autocode cancel [id]
autocode skip [id] --agent <n>
autocode retry [id] --agent <n>
```

For the full workflow API, resume/journal semantics, trusted host context, and mixed-provider examples, read `USAGE.md`, `references/authoring.md`, and `references/quality-patterns.md` in the Autocode checkout.
