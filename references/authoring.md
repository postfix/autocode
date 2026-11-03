# Autocode workflow authoring

Read [quality-patterns.md](quality-patterns.md) before designing stages. It carries the recovered Ultracode guidance on pipelines, barriers, independent verification, completeness, and bounded discovery. Choose the work list and the expected result before spawning agents. When a later phase needs the host agent to interpret earlier evidence, run separate workflows and inspect each result before writing the next.

The recovered reference describes Claude's embedded host. Autocode does not automatically transfer that host's loaded instruction set, live MCP connections, permissions or model. A trusted integration supplies `hostContext` (or serializable `--context`) for these supported fields. The SDK may load its own project configuration; that is not proof of inheriting the parent's exact context. Workflow source cannot grant itself new host authority.

Begin each `.js` script with literal metadata:

```js
export const meta = { name: 'review-changes', description: 'Review and verify changed files' };
phase('Review');
const results = await pipeline(args.files, file => agent(`Review ${file}`));
return results;
```

The script body is an async function. It receives `args`, `agent`, `parallel`, `pipeline`, `workflow`, `phase`, `log`, and `budget`. Omitted `args` is `undefined`; a supplied JSON `null` remains `null`. Return a JSON-serializable result. The runner writes `run.json` and `journal.jsonl` inside the run directory. The earlier `/* autocode {"name":"...","description":"..."} */` header still works. Use trusted scripts: Node's VM is a convenience for workflow globals, not a security boundary.

`meta` must be a literal object with a nonempty `name` and one-line `description`. Add `phases` when you want the user to see the planned stages; use those exact titles in `phase()` and agent `phase` options. Save the script, run it from the project directory, and inspect `result` and `failures` before reporting success.

## Calls

- `agent(prompt, opts?)` asks a Codex or Claude agent through its JavaScript SDK. It returns final text, or a JSON object if `opts.schema` is a root object JSON Schema. Supported options: `provider: 'codex' | 'claude'`, `schema`, `model`, `effort`, `label`, `phase`. The command's `--provider` sets the default, while `opts.provider` selects one call. Both SDKs support `low`, `medium`, `high`, `xhigh`, and `max` effort; choose a supported model for each provider. Both providers validate results against the original schema and allow up to three result attempts. Codex transports optional properties through explicit presence wrappers, then restores the original result shape; the workflow receives ordinary objects. Schemas that cannot be represented by Codex's strict transport use JSON text transport with the original schema in higher-priority instructions; results still pass the original validator and bounded repair loop.
- `isolation: 'worktree'` runs the agent in a detached Git worktree. Unchanged worktrees are removed; changed worktrees are retained in the returned `worktrees` list. `agentType` resolves a trusted host registry entry with a `prompt` and optional tool restrictions. Codex rejects custom tool restrictions it cannot enforce.
- `stallMs` sets the no-progress timeout in milliseconds; the ordinary default is 600000 (native stall/stream-idle environment overrides apply). Stalled or user-retried calls have at most five retries. Active tools suspend the no-progress timer. Inspect errors when cancellation is not acknowledged; a replacement is refused in that case.
- `parallel([() => promise, ...])` runs independent tasks and returns results in input order. A failed branch becomes `null`; inspect the top-level `failures` list.
- `pipeline(items, stage1, stage2, ...)` runs each item through its stages as soon as the prior stage finishes. Each stage receives `(previousResult, originalItem, index)`. A thrown error or `null` result ends that item and yields `null`. Use this for review then verification without a barrier.
- `phase(title)` and `log(message)` stream progress to CLI stderr as the workflow runs; logs are also returned in the final JSON. Agent starts, completions and failures stream with `opts.label` and `opts.phase` when supplied.
- `workflow(nameOrRef, childArgs?)` runs a saved `.codex/workflows/<name>.js` script or an explicit `{scriptPath: 'path/to/script.js'}`. Relative script paths resolve from the CLI working directory. Children share the same agent queue, budget and journal, and are limited to one level. Child agents use a separate workflow progress group; child phase changes leave the parent phase unchanged.
- `budget.total`, `budget.spent()`, `budget.remaining()` expose the output-token target. It stops additional calls once usage reaches the target. Concurrent calls can exceed it.

At most 16 agents run simultaneously across both providers. Each `parallel` or `pipeline` accepts at most 4096 items, and a workflow can make at most 1000 agent calls. A user skip or classified terminal API failure returns `null`; other failing agent calls reject inside their branch; `parallel` and `pipeline` turn that branch into `null` and report the error.

Use unique prompts and JSON args for reproducible resume. The journal caches successful agent results. A resumed script reuses a completed call when its branch history, prompt, effective provider, working directory, execution context, and relevant options match; execution after a cache miss runs live. Options are captured at invocation. Resume retains reported budget usage while returned `outputTokens` counts only the current attempt. After a run, check `failures` and inspect `journal.jsonl` when output looks incomplete.

`Date.now()`, `new Date()` without arguments, and `Math.random()` throw inside workflows because they would make replay depend on when the run was resumed. Pass a timestamp or seed in `args` when needed.

## Context and compaction

Each `agent()` receives its assigned prompt, explicit trusted host instructions, custom-agent instructions and configured tools/MCP. When executed live rather than replayed, it starts a fresh provider conversation. Earlier results reach another agent only when the workflow includes them in its prompt; `pipeline()` passes JavaScript values to stages, not an implicit conversation history. Include relevant evidence and source paths rather than concatenating every prior transcript. Keep stage results compact and schema-validated: conclusions, evidence/artifact references, uncertainty and unresolved scope. Do not include raw command transcripts or tool-output dumps unless a downstream task actually needs them. Within one agent, its native tool history remains part of that conversation; schema repairs intentionally retain that same task history. Input caching can reduce processing cost, but it does not remove content from the context window. The standalone output-token budget does not bound all input-token cost. See [context-forking research](../docs/CONTEXT-FORKING-RESEARCH.md).

Delegate conversation compaction belongs to the native provider engine. Autocode forwards available compaction progress into activity tracking; it does not implement a second summarizer or silently truncate prompts. Engine settings determine thresholds and whether compaction is enabled. Compaction can still fail when the initial prompt or fixed instructions exceed the available window.

There is no automatic transfer of an unfinished delegate to a replacement agent. Schema repairs retain the same Codex thread or resume the Claude session; stall/lost-reply retries start a fresh attempt with the original assigned task. An exhausted context is reported as failure, not blindly retried with the same oversized input. Inspect failures and the journal, reduce the task or material passed, and author a continuation using completed evidence.

`--resume` replays completed workflow results from `run.json` and `journal.jsonl`; it does not restore a delegate's full conversation or the parent agent's memory. Preserve the script path, args, run ID, run directory, relevant evidence paths and trusted context reference in the parent host's handoff. Re-supply host context on resume; it is not serialized into a portable parent-session capsule. If the parent compacts while a background workflow continues, rediscover it through the project controls and inspect its durable status/results.


Autocode reimplements observed local workflow behavior through native Codex and Claude SDK adapters. This public package contains the runnable implementation and authored templates.

Trusted host context can supply inherited and forced model/effort settings, project instructions, custom agents, MCP servers, permission callbacks, spawn denial, quota waiting, and a shared budget. Supply context through `--context <file>` for JSON data or `runWorkflow({hostContext})` for callbacks. Every context needs `id` and `revision`; change the revision when host policy or context changes. The runner never treats task text as authority to expand these permissions. Embedded calls with nonempty `hostContext.providers` configuration must declare `defaultProvider` or a per-call `provider`; an omitted provider is rejected rather than silently bypassing its model or policy settings. Shared budget callbacks are synchronous: `spent()` must return a nonnegative safe integer, and `charge(delta)` must complete synchronously. The trusted host owns the ledger accounting.

Use `autocode workflows --json` to discover `whenToUse` metadata without running scripts. Invoke the returned `reference` with `workflow(reference, args)`. Trusted host registries can restrict child execution to named entries with `namedWorkflowsOnly: true`. Codex supports the native Bash denial; other unsupported restrictions remain explicit errors.

New run journals use `.autocode/runs`; project controls also discover legacy `.codex/autocode-runs`. For asynchronous execution, use a host-native background agent/task with mandatory completion/failure delivery, running the CLI in the foreground. Bare `--background` is rejected. Custom embedded notification integrations require paired `onComplete` and `onFailure` callbacks; ordinary awaited calls return through their promise. Export/import journal snapshots with the exact commands in USAGE.md; preserve worktree contents separately.

## Required completion delivery

Every launched workflow needs a completion owner before it starts. An awaited API call or foreground CLI returns success/failure to its caller. If the originating Codex/Claude session will continue while work runs, use its native background agent/task lifecycle to deliver both terminal outcomes and monitor process death. The owner must retain the run ID and directory, inspect `result` and `failures`, and report the outcome to the originating session. If native delivery is unavailable, keep waiting through the host tool's execution session until it settles.

Custom host notification integrations must supply both `hostContext.onComplete(output)` and `hostContext.onFailure({runId,error})` as functions. The runner rejects partial/malformed pairs before creating run files. Completion callbacks run after terminal journal state is saved; callback delivery errors do not rerun completed work or replace its original error. Callbacks are trusted integration points: writing a log, file or status record does not establish delivery to the main agent. In-process callbacks alone cannot survive a killed host process; use the independent native lifecycle monitor for that case.

Workflow JavaScript templates describe stages and results; they cannot create the originating host's notification channel. Their launch contract is therefore mandatory: await the result, or register the native background lifecycle before execution. Raw CLI detachment without that route is refused rather than silently leaving the session uninformed.
