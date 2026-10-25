# Autocode workflow authoring

Begin each `.js` script with literal metadata:

```js
export const meta = { name: 'review-changes', description: 'Review and verify changed files' };
phase('Review');
const results = await pipeline(args.files, file => agent(`Review ${file}`));
return results;
```

The script body is an async function. It receives `args`, `agent`, `parallel`, `pipeline`, `workflow`, `phase`, `log`, and `budget`. Omitted `args` is `undefined`; a supplied JSON `null` remains `null`. Return a JSON-serializable result. The runner writes `run.json` and `journal.jsonl` inside the run directory. The earlier `/* autocode {"name":"...","description":"..."} */` header still works. Use trusted scripts: Node's VM is a convenience for workflow globals, not a security boundary.

## Calls

- `agent(prompt, opts?)` asks a Codex or Claude agent through its JavaScript SDK. It returns final text, or a JSON object if `opts.schema` is a root object JSON Schema. Supported options: `provider: 'codex' | 'claude'`, `schema`, `model`, `effort`, `label`, `phase`. The command's `--provider` sets the default, while `opts.provider` selects one call. Both SDKs support `low`, `medium`, `high`, `xhigh`, and `max` effort; choose a supported model for each provider.
- `agentType` and `isolation: 'worktree'` currently raise explicit errors in the SDK adapters.
- `parallel([() => promise, ...])` runs independent tasks and returns results in input order. A failed branch becomes `null`; inspect the top-level `failures` list.
- `pipeline(items, stage1, stage2, ...)` runs each item through its stages as soon as the prior stage finishes. Each stage receives `(previousResult, originalItem, index)`. A thrown error or `null` result ends that item and yields `null`. Use this for review then verification without a barrier.
- `phase(title)` and `log(message)` stream progress to CLI stderr as the workflow runs; logs are also returned in the final JSON. Agent starts, completions and failures stream with `opts.label` and `opts.phase` when supplied.
- `workflow(nameOrRef, childArgs?)` runs a saved `.codex/workflows/<name>.js` script or an explicit `{scriptPath: 'path/to/script.js'}`. Relative script paths resolve from the CLI working directory. Children share the same agent queue, budget and journal, and are limited to one level.
- `budget.total`, `budget.spent()`, `budget.remaining()` expose the output-token target. It stops additional calls once usage reaches the target. Concurrent calls can exceed it.

At most 16 agents run simultaneously across both providers. Each `parallel` or `pipeline` accepts at most 4096 items, and a workflow can make at most 1000 agent calls. A failing agent call rejects inside its branch; `parallel` and `pipeline` turn that branch into `null` and report the error.

Use unique prompts and JSON args for reproducible resume. The journal caches successful agent results. A resumed script reuses a completed call when its branch history, prompt, and relevant options match; edits beyond that point run live. After a run, check `failures` and inspect `journal.jsonl` when output looks incomplete.

`Date.now()`, `new Date()` without arguments, and `Math.random()` throw inside workflows because they would make replay depend on when the run was resumed. Pass a timestamp or seed in `args` when needed.

Autocode reimplements observed local workflow behavior through native Codex and Claude SDK adapters. This public package contains the runnable implementation and authored templates.
