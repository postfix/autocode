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

`--provider` selects the default for calls without `opts.provider`. Use `--provider claude` to change it. Use `--args '{"target":"src"}'` to supply a JSON value; omitted `args` is `undefined`. `--cwd <directory>` selects the project directory for both SDKs and workflow discovery. Journals default to that project’s `.autocode/runs/<id>/`; `--run-dir <directory>` optionally changes storage without changing the owning project. `--budget <tokens>` sets a soft output-token target: calls already running can make the final total exceed it.

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

Statistics retain labels, phases, timings, reported token counts, and bounded tool/error excerpts rather than full tool arguments or token streams. Common credential-shaped values and terminal controls are removed from excerpts; inspect error text before sharing it. At most 1,000 activity events and the most recent 1,000 agent rows are displayed; per-agent activity is limited to 20 entries. Large result records are skipped by the streaming statistics reader, while the original journal remains available. Totals cover reported completed and failed-call usage across attempts, including cached replay rows with no new usage. Failed/in-flight call usage and SDK-default model identity can be unknown; no price estimate is invented.

## Workflow operations

| Operation | Behavior |
| --- | --- |
| `agent(prompt, opts?)` | Runs a Codex or Claude SDK agent. `opts` can set `provider`, `model`, `effort`, `schema`, `label`, and `phase`. A root-object JSON Schema requests structured output. |
| `parallel([() => task, ...])` | Runs branches concurrently and preserves input order. A failing branch yields `null` and appears in `failures`. |
| `pipeline(items, ...stages)` | Advances each item independently through stages. A `null` or failed item skips later stages. |
| `workflow(nameOrRef, childArgs?)` | Runs a saved `.codex/workflows/<name>.js` file or `{scriptPath: 'child.js'}`. Children share the queue, budget, and journal; nesting is limited to one level. |
| `phase(title)`, `log(message)` | Streams progress and records logs. `opts.phase` and `opts.label` identify individual agent calls. |
| `budget` | Exposes `total`, `spent()`, and `remaining()`. |

The runner allows up to 16 concurrent agents, 1,000 agent calls per workflow, and 4,096 items in one `parallel` or `pipeline` call. `isolation: 'worktree'` creates a detached working copy and retains edits in the returned `worktrees` paths. Custom `agentType` definitions come from trusted host context. Unsupported tool restrictions fail explicitly.

## Permissions and templates

Both providers default to read-only operation. Pass `--sandbox workspace-write` only when edits are authorized. Codex uses its SDK thread sandbox; Claude receives file tools and SDK sandboxing; workspace-write mode also exposes Bash for authorized build/test commands. Native permissions or a host callback still decide whether commands may execute. Inspect the returned `failures` before treating a workflow as successful.

Start from [parallel scout](assets/templates/parallel-scout.js), [review and verify](assets/templates/review-and-verify.js), [exhaustive review](assets/templates/exhaustive-review.js), or [mixed provider](assets/templates/mixed-provider.js). Read the [authoring reference](references/authoring.md) for deterministic resume and workflow globals, and the [quality patterns](references/quality-patterns.md) for the recovered decomposition, verification, and completeness prompts.

## Background and individual agent controls

On Linux, `autocode run inspect.js --background` returns `{runId, runDir, state}` after startup. Use the existing status, pause, resume and cancel commands for that ID. `stdout.log` and `stderr.log` retain the program output.

Use `autocode skip <id> --agent 1` to return `null` from one active agent call, or `autocode retry <id> --agent 1` to cancel and replace its attempt. Requests are authenticated by the controller and acknowledged by the worker. Retry is bounded; an agent that does not acknowledge cancellation is not restarted concurrently.

## Trusted host context

`autocode run inspect.js --context context.json` loads JSON context. A minimal example is:

```json
{"id":"session-id","revision":"1","providers":{"codex":{"model":"your-model","effort":"high"}}}
```

The embedded `runWorkflow({hostContext})` interface additionally accepts callbacks. Context fields currently implemented are:

- `id` and `revision`: required nonempty strings, included in replay identity. Increment the revision when instructions, agent definitions, MCP configuration or policy changes.
- `instructions`: trusted project instructions delivered above the task text.
- `providers.codex` and `providers.claude`: `model`, `effort`, `forcedModel`, `forcedEffort`, and provider-native `mcpServers` configuration.
- `agents`: registry keyed by `agentType`, with `prompt` and optional `tools`/`disallowedTools`. Codex refuses tool-restricted entries rather than dropping their restrictions.
- `onSpawn({prompt, options, workflow, signal})`: optional async hook; return `{deny: "reason"}` to refuse, or `{prompt, model}` to rewrite those fields. Rewrites participate in replay identity; a forced host model still wins. `workflow` is an immutable `{runId, agentIndex}`. Set `shareWorkflowPrompt: false` to withhold task text from this hook and disable its prompt rewrites.
- `canUseTool`: Claude SDK permission callback; JSON files cannot supply functions. Both Codex transports refuse contexts that require this unsupported permission callback; ordinary calls without it still run.
- `budget`: `{total, spent(), charge(delta)}` shared by embedded workflows. These callbacks are synchronous and must share one authoritative ledger; a host can charge main-agent usage into the same ledger. Standalone budgets cover runner-owned reported output usage.
- `waitForQuota({provider, rateLimit, signal})`: optional host coordinator; return `true` after an authorized quota wait to retry, or decline to return a terminal `null` result. Respect the supplied abort signal.

The host supplies this context outside workflow source. Standalone execution does not automatically inherit the parent transcript, live MCP connections, permission decisions or turn-wide token usage.

### Running the SDK inside another Codex session

A nested SDK process needs a writable, authenticated Codex state directory and a parent command sandbox that permits network access. A network-denied parent prevents the child SDK from contacting its provider, even when the child's own thread sandbox is configured correctly. An observed failure is `workspace routing discovery failed`.

The trusted host can set `providers.codex.codexHome` to a private directory (mode `0700`) outside protected `.codex` paths:

```json
{"id":"parent-session","revision":"1","providers":{"codex":{"codexHome":"/absolute/private/sdk-state"}}}
```

Initialize that directory through the host's authenticated Codex setup. Keep authentication private; never put credential contents into workflow source or context JSON. The adapter inherits the host process environment and overrides only `CODEX_HOME`. Model, instructions and MCP configuration still need the documented explicit context fields.

For a Codex SDK parent, permit the required provider network traffic while retaining its workspace filesystem sandbox:

```js
const parent = new Codex({
  config: { sandbox_workspace_write: { network_access: true } }
});
const thread = parent.startThread({
  workingDirectory: project,
  sandboxMode: 'workspace-write',
  approvalPolicy: 'never',
  skipGitRepoCheck: true
});
```

The equivalent native configuration is:

```toml
sandbox_mode = "workspace-write"
approval_policy = "never"

[sandbox_workspace_write]
network_access = true
```

This permission applies to commands launched by the parent. It does not change Autocode's default read-only child sandbox. A real parent-to-CLI-to-Codex SDK canary completed with this configuration and returned `NESTED_SDK_OK`; this does not establish automatic transcript, plugin-hook or live MCP connection inheritance.

## Replay compatibility

New journals use version 2. Older journals remain intact but cannot be replayed safely because their branch identities can be ambiguous. Inspect their results and start a fresh run in a new directory. Resume preserves a truncated final journal record in a `.partial-*` file and repairs the completed prefix atomically; corruption inside the journal is still an error.

`budget.spent()` retains historical reported output usage on resume. Returned `outputTokens` remains the usage of the current attempt, so cached answers do not incur a second charge. In-flight calls can exceed the admission threshold. Failed calls are charged when the provider reports usage; unreported usage remains unknown.

## Saved workflow discovery

Run `autocode workflows --json` to list saved project workflows and their `whenToUse` metadata without executing their bodies. `--cwd <project>` selects a project. Invoke a discovered child with `workflow(entry.reference, args)`; the reference may differ from its display name.

`--context <file>` adds trusted `workflows` entries mapping references to source strings. A context with `namedWorkflowsOnly: true` discovers and executes only that host registry; child `{scriptPath}` references are refused. Root script selection remains an explicit CLI input.

Provider restrictions are optional. Codex supports `disallowedTools: ['Bash']` through its native command-tool switch. Claude supports native `disallowedTools`, trusted custom-agent tool pools and host permission callbacks. These implemented controls remain active.

Other Codex tool denials, custom tool pools and universal host permission callbacks are excluded from the agreed scope. Nonempty `bashCommandClamp` policies are excluded on both providers. An explicitly requested unsupported policy produces a capability error before provider startup; it is never silently ignored. Omitted restrictions and empty command clamps add no restriction, so ordinary execution does not require those capabilities. The scope does not include an engine fork or a Factory executor project. See the [capability scope decision](docs/REMAINING-PARITY-BACKEND.md) and [original requirement matrix](docs/PARITY-STATUS.json).

New runs register under `.autocode/runs` so startup can run in hosts that protect `.codex`. Project controls also discover legacy `.codex/autocode-runs` directories; existing files are not moved.

## Journal snapshots and host notifications

Export with `autocode export --run-dir <run> --to <new-snapshot-directory>`. Import with `autocode import --from <snapshot> --run-dir <new-run-directory>`. Both destinations must be new directories. Import returns a new run ID; pass it to `run <script> --run-dir <new-run-directory> --resume <id>` with the original arguments and execution context. Changed context invalidates cached results.

Snapshots contain `run.json` and `journal.jsonl`, not controller tokens, project files or retained worktree contents. Preserve those files separately when moving between machines.

Embedded hosts can supply `onComplete(output)` and `onFailure({runId,error})`. Notification failures preserve the completed result or original workflow error and remain in the journal/status. A successful response with missing provider usage sets `usageIncomplete: true`; numeric token totals are lower bounds when this flag is present.

Calls sharing an instruction prefix wait for the first genuine model response, up to five seconds; a warm prefix expires after 270 seconds. Prefix coordination is shared by workflows using the same trusted host context object. Provider initialization alone does not release waiting calls.

A measured slow response with fewer than 50 output tokens, no stop reason, and no structured result follows the recovered single 45-second backoff and retry policy. Missing provider metadata does not trigger this heuristic. Both attempts count toward reported output usage.

Codex uses native strict structured output where the schema can be represented faithfully. Other valid object schemas, including intersections, boolean subschemas, tuple items and open objects, use JSON text transport. The original JSON Schema still validates every returned result, and invalid JSON/results consume the same bounded repair attempts.

### Native Codex transport

Set trusted context `providers.codex.transport` to `"app-server"` to use the native stdio protocol instead of the default `"exec"` SDK transport. It resolves the executable from the pinned SDK installation, preserves the same sandbox, instructions, schema repair and explicit state-home settings, and retains native typed failures and authoritative quota metadata. A native retry notification does not trigger a second runner retry. Final API failures return `null` with a recorded failure; transport and programming errors propagate. Lost-stream failures use the bounded recovery policy.

This transport keeps the same capability checks for host permission callbacks and tool restrictions. Native approval requests do not intercept every tool operation. Quota snapshots do not authorize resuming from percentages or reset times; the trusted quota coordinator must release a wait.
