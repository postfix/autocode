---
name: autocode
description: Build and run JavaScript multi-agent workflows when the user requests Autocode, parallel agents, fan-out verification, or a saved workflow.
---

# Autocode

For statistics or pause/resume/cancel/skip/retry of an existing run, use **Inspect and control** below directly. Select the existing run directory; these requests do not start another workflow.

Deliver the workflow's verified result when the user invokes Autocode or asks for multi-agent orchestration. Handle a conversational answer or trivial edit directly. For an exhaustive request, cover the discovered work list, verify findings independently, and log any omitted scope. Agent calls can spend substantial tokens; follow the user's scale and budget. The authoring agent can use high effort while each delegated `agent()` call uses a smaller model, lower effort, or another provider when that fits its task.

Run workflows after explicit opt-in through one of these five cases:

- A qualifying human `autocode` keyword prompt, confirmed by the host reminder.
- Standing mode, confirmed by the host reminder.
- A direct request in the user's own words to run a workflow, fan out agents, or orchestrate subagents.
- An invoked skill or slash command that instructs workflow execution.
- A request to run a named or saved workflow.

For other tasks, explain the proposed workflow's scale and cost and obtain opt-in before orchestration. A task benefiting from parallelism is not itself opt-in. Keep previously authorized work within its agreed scope and budget.

When the optional Autocode plugin supplies a keyword or session-mode reminder, treat it as the user's workflow opt-in. In standing mode, author and run a workflow for every substantive task; use solo work for conversation and trivial edits. `autocode off` returns to explicit opt-in.

## Author

Read the [recovered Autocode authoring reference](references/source-prompts/authoring.md) for its full decomposition, verification, and worked-example prose. Read [authoring.md](references/authoring.md) for the Autocode API and differences: use the saved script and CLI command below where the recovered reference says to call Claude's `Workflow` tool; use SDK structured output where it names `StructuredOutput`; use the runner's soft output-token budget and documented limits. Read [quality-patterns.md](references/quality-patterns.md) for runnable Autocode examples. Inspect the target first to make the work list. Use `pipeline()` by default when each item can advance independently; use a `parallel()` barrier when the next stage needs all prior results. For multi-phase tasks, inspect each phase's result before authoring the next workflow when the next step requires a new judgment.

Autocode's execution differences take precedence over the recovered Claude reference: the standalone runner does not transfer the parent's already-loaded instructions, live MCP connections, permissions, or main-loop model automatically. A trusted host supplies applicable context and provider defaults explicitly. Without it, use the SDK's own documented defaults; do not claim the parent's context was inherited.

Choose a runnable starting point and supply its required `args`:

- [review-and-verify.js](assets/templates/review-and-verify.js): `{ "topics": ["src/a.js"] }`.
- [review-fix-loop.js](assets/templates/review-fix-loop.js): `{ "packet": "task-packet.md", "reportRoot": "reports/", "maxRounds": 3 }`. For repeated review/fix/QA, pass current open findings and report references; never accumulate full round results into later prompts.
- [exhaustive-review.js](assets/templates/exhaustive-review.js): `{ "topics": ["src/a.js"] }`. It stops after two dry rounds and a completeness check; an optional explicit `maxRounds` returns incomplete coverage if reached.
- [parallel-scout.js](assets/templates/parallel-scout.js): `{ "questions": ["Inspect src/a.js"] }`.
- [mixed-provider.js](assets/templates/mixed-provider.js): `{ "tasks": [{ "question": "Inspect src/a.js", "provider": "codex" }] }`.

Save the script in the project where it will run. It is ready to run when its literal `meta` has a name and description, its `args` match the chosen template or script, and it returns a JSON-serializable result.

## Run

From that project directory, run the script with:

```bash
autocode run workflow.js --provider codex --args '{"topics":["src/a.js"]}'
```

Use `--provider claude` when Claude should execute calls by default, or `--provider omp` for Oh My Pi. Omit per-call model and effort to use resolved host/provider defaults; an explicit trusted forced model takes precedence over workflow choices. Set a provider, model, and effort for a specific call with `agent(prompt, { provider: 'claude', model: 'haiku', effort: 'low' })`. The Codex and Claude adapters use native JavaScript SDKs; the OMP adapter drives the `omp` binary in `--mode rpc`. Progress streams to stderr; stdout contains JSON with `result`, `failures`, `logs`, `agentCount`, `outputTokens`, `runId`, and `runDir`. Pass `--run-dir <dir>` to choose a journal location. Resume the same script and directory with `--resume <runId>`; completed calls with unchanged inputs replay from the journal until execution diverges. Legacy journals without version 2 require a fresh run; retain their files for inspection. Use `--budget <tokens>` for a soft output-token target. Delegated agents default to read-only tools; set `--sandbox workspace-write` when the user authorized edits.

Completion delivery is required before launch. Keep the foreground command or embedded promise awaited until it returns its result or failure. For session-owned background work, start a host-native background agent/task whose registered lifecycle delivers both completion and failure to the originating Codex/Claude session; that task runs the CLI in the foreground, inspects the result and reports it back. If the host has no such mechanism, stay awaited. Do not end the main turn with an unattended workflow.

Bare `--background` is rejected because a detached process, run ID, status file or journal does not notify the originating session. A custom embedded notification integration must supply BOTH `hostContext.onComplete` and `hostContext.onFailure` before starting, wire them to actual host delivery, and retain an independent native task monitor for process death. A callback that only writes a file does not satisfy delivery. Terminal state is persisted before notification; delivery failure is distinct from workflow failure. See [the completion contract](references/authoring.md#required-completion-delivery).

Use `agent(prompt, {isolation: 'worktree'})` for authorized parallel edits. Changed worktrees are retained and returned in `worktrees`; inspect those paths before merging. Select a custom `agentType` only when the trusted host context supplies that registry entry. Load serializable host context with `autocode run workflow.js --context context.json`; use the host API for permission callbacks and shared turn budgets. Inspect failures when a requested restriction is unsupported.

## Inspect and control

Use the current project folder. The runner prints the workflow ID when it starts; no run directory is needed for controls:

```bash
autocode ps
autocode status [id]
autocode status [id] --json
autocode status [id] --agent <agent-row-id>
autocode pause [id]
autocode resume [id]
autocode cancel [id]
```

To skip or retry one active agent, run `autocode skip <id> --agent <agent-row-id>` or `autocode retry <id> --agent <agent-row-id>`. Skipping returns `null` to the script; the workflow can continue. Retry cancels the current attempt before starting its replacement.

`[id]` is optional syntax: replace it with a workflow ID or omit it. `ps` lists active and paused workflows in this project, including embedded `runWorkflow()` calls and custom journal locations. On Linux, embedded status verifies both owner PID and process start identity; dead owners are interrupted, not running. The Controls column distinguishes CLI process controls from host-controlled embedded runs. With exactly one active workflow, a command without an ID selects it automatically. With several, list their IDs, names and states and ask which to manage; do not choose one yourself. A terminal asks interactively; host tools receive a `selection-required` response and question. After the user's choice, rerun the requested command with that ID. With none active, report that no active workflow was found in the current project; do not claim that no workflow exists elsewhere or infer liveness from an old journal. An explicit `status <id>` also inspects completed, failed or cancelled workflows.

Details include phases, agents, provider/requested model, elapsed time, reported tokens and recorded errors, including tool errors inside otherwise successful agents. Show the actual errors; missing usage is unknown, not zero or an estimate.

On Linux, `pause` freezes the running program and its owned process tree; `resume` continues that same run. `cancel` terminates the program and agents, keeping its journal and existing files. It does not undo writes. A later `run ... --resume <runId>` starts journal replay after termination; it differs from resuming a paused live program. Local pause cannot guarantee that a remote provider stops inference or billing, and wall-clock deadlines can expire while paused.

Live controls require a run started by the updated CLI. Embedded `runWorkflow()` calls and older runs have no CLI controller. Use their owner's controls. Read [USAGE.md](USAGE.md#inspect-and-control-a-running-program) for limits and retained errors.

## Check the result

Read the returned `result` and `failures` before answering the user. The task is complete when the result satisfies the requested work and each claimed finding has the requested evidence or verification. Report failed branches, unreadable sources, and any omitted scope. If a run fails, inspect `journal.jsonl` in its `runDir` before retrying or resuming.

The Codex SDK starts another Codex process. If the host tool sandbox reports `Read-only file system` while that process initializes, rerun the same reviewed script from a permitted shell that can write Codex state; keep delegated calls read-only unless edits were authorized. If no such execution is available, report the failed run.

The runner needs Node.js 20+, the globally installed `autocode-skill` npm package, and authentication for the selected provider. `npm install -g autocode-skill` provides its dependencies and the `autocode` command. A passing `npm test` in a source checkout checks the local runner and templates; the task's workflow result still needs inspection.
