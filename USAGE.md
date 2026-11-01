# Using Autocode

## Ask the skill to run a task

After [installing the skill](INSTALL.md), ask Codex:

```text
$autocode Investigate the failing tests in this project in parallel, verify the likely cause, and summarize the evidence.
```

In Claude, ask it to use the `autocode` skill with the same request. The skill authors the JavaScript workflow and runs it. You can ask for Codex, Claude, or both as delegated providers, and specify the model or effort for individual tasks. The authoring agent can use higher effort than the delegated agents. Review the reported `failures` alongside the result.

With the [host plugin](INSTALL.md#install-the-skill-and-session-hooks), a human request using the unquoted word `ultracode` triggers Autocode for that turn. `autocode on` enables standing mode for substantive tasks; `autocode off` exits it. A skill-only checkout remains usable through explicit invocation without hooks.

## Write a workflow yourself

Start with literal metadata. The remaining JavaScript runs as an async body with `args`, `agent`, `parallel`, `pipeline`, `workflow`, `phase`, `log`, and `budget` available:

```js
export const meta = { name: 'inspect', description: 'Inspect two questions' };
phase('Inspect');
return await parallel([
  () => agent('Find likely bugs', { provider: 'codex', effort: 'low', label: 'bugs' }),
  () => agent('Check documentation', { provider: 'claude', model: 'haiku', effort: 'low', label: 'docs' }),
]);
```

Save the file as `inspect.js`. The host agent can spend more effort designing this workflow; the `model` and `effort` options control each delegated call. Omitting `model` lets the selected SDK choose its configured default.

## Run and resume

```bash
autocode run inspect.js --provider codex
```

The `autocode` command is installed by `npm install -g autocode-skill`. From a source checkout, run `node scripts/autocode.mjs` with the same arguments while in that checkout.

`--provider` selects the default for calls without `opts.provider`. Use `--provider claude` to change it. Use `--args '{"target":"src"}'` to supply a JSON value; omitted `args` is `undefined`. `--cwd <directory>` selects the project directory for both SDKs and workflow discovery. Journals default to that project’s `.codex/autocode-runs/<id>/`; `--run-dir <directory>` optionally changes storage without changing the owning project. `--budget <tokens>` sets a soft output-token target: calls already running can make the final total exceed it.

The command returns JSON with `result`, `failures`, `logs`, `agentCount`, `outputTokens`, `runId`, and `runDir`. Progress appears on stderr. To resume, run the same script with the same `--run-dir` and `--resume <runId>`. Successful calls whose inputs and branch history match are reused from `journal.jsonl`.

## Inspect and control a running program

The runner prints `Autocode workflow: <id>` on stderr at startup. From the same project folder, use:

```bash
autocode ps
autocode status [id]
autocode status [id] --json
autocode status [id] --agent 2
autocode pause [id]
autocode resume [id]
autocode cancel [id]
```

`[id]` is optional: supply an ID shown by `ps`, or leave it out. `ps` lists active and paused workflows in the current project, with phases, agent counts, output tokens and error counts. A custom journal location is registered in its owning project and remains discoverable without a path. Another project cannot select that workflow by ID. `--cwd` at launch chooses the owning project; otherwise it is the launch directory.

With one active workflow, omitting the ID selects it. With several, the command lists workflows and asks which ID to manage, without changing any workflow. An interactive terminal waits for the choice. In a host tool or with `--json`, it returns `selection-required` and a question; the host asks the user and then repeats the command with their chosen ID. With no active workflow it reports that fact. `status <id>` can also inspect a retained completed, failed or cancelled workflow. `--run-dir` remains available for older runs and direct journal inspection; it is not needed for normal management.

Status shows the workflow and phase, queued/running/completed/failed agents, requested model/provider, wall-clock elapsed time, reported tokens, and errors. Tool failures remain visible when an agent recovers and succeeds. Text shows the latest 20 agent rows; `--agent <agent-row-id>` selects one retained row with its activity and errors. `--json` returns all retained rows as structured data. These commands do not need a model call.

On Linux, pause stops the current program and its owned descendant processes, including active agents; the separate controller remains available for status, resume and cancel. Resume continues the same process identities. Cancel immediately terminates that program and its recorded process tree, confirms termination, and returns the run as cancelled. The original run command exits 130. Journals and files already written remain; cancellation does not roll back edits. To replay retained successful calls after termination, use `run <script> --run-dir <directory> --resume <runId>`.

Live controls apply to runs launched by this updated CLI on Linux. Other platforms retain ordinary run/journal support. Embedded API users control their own host process. Older runs lack a controller and some telemetry; missing data stays unknown. An unavailable controller is not treated as successful pause/cancellation or permission to start a duplicate run. A retained `controller.lock` after abnormal controller death requires checking the original run before recovery.

Pausing local processes does not pause a remote provider's inference or guarantee that billing stops. Provider requests and wall-clock deadlines may finish or expire while local execution is frozen.

Statistics retain labels, phases, timings, reported token counts, and bounded tool/error excerpts rather than full tool arguments or token streams. Common credential-shaped values and terminal controls are removed from excerpts; inspect error text before sharing it. At most 1,000 activity events and the most recent 1,000 agent rows are displayed; per-agent activity is limited to 20 entries. Large result records are skipped by the streaming statistics reader, while the original journal remains available. Totals cover reported completed calls across attempts, including cached replay rows with no new usage. Failed/in-flight call usage and SDK-default model identity can be unknown; no price estimate is invented.

## Workflow operations

| Operation | Behavior |
| --- | --- |
| `agent(prompt, opts?)` | Runs a Codex or Claude SDK agent. `opts` can set `provider`, `model`, `effort`, `schema`, `label`, and `phase`. A root-object JSON Schema requests structured output. |
| `parallel([() => task, ...])` | Runs branches concurrently and preserves input order. A failing branch yields `null` and appears in `failures`. |
| `pipeline(items, ...stages)` | Advances each item independently through stages. A `null` or failed item skips later stages. |
| `workflow(nameOrRef, childArgs?)` | Runs a saved `.codex/workflows/<name>.js` file or `{scriptPath: 'child.js'}`. Children share the queue, budget, and journal; nesting is limited to one level. |
| `phase(title)`, `log(message)` | Streams progress and records logs. `opts.phase` and `opts.label` identify individual agent calls. |
| `budget` | Exposes `total`, `spent()`, and `remaining()`. |

The runner allows up to 16 concurrent agents, 1,000 agent calls per workflow, and 4,096 items in one `parallel` or `pipeline` call. `agentType` and `isolation: 'worktree'` currently raise explicit errors.

## Permissions and templates

Both providers default to read-only operation. Pass `--sandbox workspace-write` only when edits are authorized. Codex uses its SDK thread sandbox; Claude receives limited file tools and SDK sandboxing. Inspect the returned `failures` before treating a workflow as successful.

Start from [parallel scout](assets/templates/parallel-scout.js), [review and verify](assets/templates/review-and-verify.js), [exhaustive review](assets/templates/exhaustive-review.js), or [mixed provider](assets/templates/mixed-provider.js). Read the [authoring reference](references/authoring.md) for deterministic resume and workflow globals, and the [quality patterns](references/quality-patterns.md) for the recovered decomposition, verification, and completeness prompts.
