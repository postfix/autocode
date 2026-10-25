# Using Autocode

## Ask the skill to run a task

After [installing the skill](INSTALL.md), ask Codex:

```text
$autocode Investigate the failing tests in this project in parallel, verify the likely cause, and summarize the evidence.
```

In Claude, ask it to use the `autocode` skill with the same request. The skill authors the JavaScript workflow and runs it. You can ask for Codex, Claude, or both as delegated providers, and specify the model or effort for individual tasks. The authoring agent can use higher effort than the delegated agents. Review the reported `failures` alongside the result.

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
autocode run inspect.js \
  --provider codex --run-dir .codex/autocode-runs/inspect
```

The `autocode` command is installed by `npm install -g autocode-skill`. From a source checkout, run `node "$HOME/.codex/skills/autocode/scripts/autocode.mjs"` with the same arguments.

`--provider` selects the default for calls without `opts.provider`. Use `--provider claude` to change it. Use `--args '{"target":"src"}'` to supply a JSON value; omitted `args` is `undefined`. `--cwd <directory>` selects the project directory for both SDKs. `--budget <tokens>` sets a soft output-token target: calls already running can make the final total exceed it.

The command returns JSON with `result`, `failures`, `logs`, `agentCount`, `outputTokens`, `runId`, and `runDir`. Progress appears on stderr. To resume, run the same script with the same `--run-dir` and `--resume <runId>`. Successful calls whose inputs and branch history match are reused from `journal.jsonl`.

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
