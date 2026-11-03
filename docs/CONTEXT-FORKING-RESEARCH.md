# Context forking and result-only workflow handoffs

Research date: 2026-11-03. Applied `research` and `leanrea`; reused the existing local extraction and inspected pinned packages before consulting official documentation. **Seen** below means source, declarations, or installed CLI help inspected directly, not a live fork experiment. **Recommendation/inference** means a design conclusion. No production changes or fork benchmark were performed.

## Answer for this workflow

**Keep fresh, result-only stages as the default.** A downstream agent should receive a compact task brief, selected upstream results, and artifact references. It should not automatically receive the previous agent's conversation or raw tool output. The runner supports that transport, but the workflow chooses the actual payload: fresh agents alone do not prevent a script from serializing all earlier results into each new prompt. Forking is a different, optional operation: it starts another conversation from an existing history prefix and therefore retains that prefix's content.

“Result-only” does not mean omitting the current task, required instructions, or evidence. Those still need explicit delivery. It means excluding another stage's incidental conversation and tool transcript.

## What the article contributes

The [HumanLayer article](https://www.humanlayer.dev/blog/context-forking-to-save-time-trouble-and-tokens), published May 15, 2026, recommends branching or rewinding a useful conversation checkpoint. Its examples cover correcting direction, exploring alternatives, and returning to a checkpoint before excessive output polluted the conversation. It distinguishes conversation state from agent-specific filesystem behavior. This is a useful exploration pattern, but does not establish that cloning history is preferable to small, independent stage inputs. We should evaluate the selected context, not treat a fork as automatic context reduction. These are the article's proposals, not measured savings for Autocode.

## Three different mechanisms

| Mechanism | What the next model receives | Current Autocode behavior |
| --- | --- | --- |
| Fresh result-only stage | New assigned prompt, applicable instructions/tools, and selected result fields | Available building block; the workflow must select the fields |
| Explicit accumulated-history handoff | All previous structured results plus any documents the stage rereads | The original SF loop did this despite starting fresh agents; now corrected |
| Continue the same agent | Its existing native conversation, including its own earlier tool calls/results | Happens inside a native agent loop; schema correction also reuses/resumes its conversation |
| Fork a checkpoint conversation | A copy/branch of the selected existing history prefix, then a new task | Provider primitives exist, but no workflow fork option is currently exposed or used |

A workflow journal replay is separate from all three: it reuses completed return values. It does not restore a native conversation or the live JavaScript stack.

## Literal current dataflow

**Seen:** `pipeline()` stores the previous stage's returned value in `value`, then invokes `stage(value, item, index)`. That is a JavaScript value, not a conversation. The stage decides whether and how to put it into a subsequent model prompt. See [runtime.mjs, pipeline](../scripts/runtime.mjs#L468), especially lines 477–480.

**Seen:** `invokeAgent` receives one prompt plus options, resolves trusted provider/custom defaults, and calls the adapter with that prompt. A completed adapter result is cloned, journaled, and returned to the script. There is no automatic concatenation of earlier stage tool messages. See [runtime.mjs, invokeAgent](../scripts/runtime.mjs#L346), [adapter dispatch](../scripts/runtime.mjs#L411), and [result return](../scripts/runtime.mjs#L426).

**Seen:** Codex constructs a new client/thread for each logical adapter invocation; the supplied host instructions and workflow return contract become developer instructions, while the assigned task goes to `thread.run`/`runStreamed`. See [codex-adapter.mjs](../scripts/codex-adapter.mjs#L122), lines 122–130 and 140–160. Claude supplies a separate system prompt and task to `query`, initially without `resume` or `forkSession`. See [claude-adapter.mjs](../scripts/claude-adapter.mjs#L46), lines 46–57 and 74–77.

A complete small example of explicitly passing a bounded result rather than history:

```js
export const meta = { name: 'brief-and-verify', description: 'Pass compact review briefs to independent verification' };
const briefSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string', maxLength: 2000 },
    artifactPaths: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 512 } },
  },
  required: ['summary', 'artifactPaths'],
  additionalProperties: false,
};
return pipeline(args.files,
  file => agent(`Review ${file}. Return a compact summary and relevant existing artifact paths.`, { schema: briefSchema }),
  (brief, file) => agent(`Independently verify the review of ${file}. Read referenced evidence as needed. Brief: ${JSON.stringify(brief)}`, { schema: briefSchema }));
```

These example limits are illustrative and should match the task; invalid oversized results go through schema validation/repair rather than silent truncation. The snippet is an authoring illustration, not a live fork benchmark. Replay cache hits can return a completed result without creating another model conversation.

The limits above are illustrative choices to adjust to the task scope, not universal thresholds. Invalid oversized results fail schema validation and take the normal bounded repair/error path; the example does not silently truncate evidence. The second agent receives the serialized `brief` because the workflow explicitly includes it. Neither `pipeline()` nor the adapter adds the first agent's raw tool output. Artifact paths are references, not automatic file content, access grants, or a promise that an artifact exists. The example assumes authorized file-reading tools; it does not create artifacts or widen permissions.

### Exceptions and boundaries

- **Seen:** Within one logical agent call, the native engine retains the agent's own working conversation and tool results. Fresh stages do not prevent an individual long stage from accumulating context.
- **Seen:** Codex schema repair calls the same `Thread` again, so its thread ID/history carries forward. Claude sets `options.resume = completed.session_id` before schema correction. See [Codex repair](../scripts/codex-adapter.mjs#L169) and [Claude repair](../scripts/claude-adapter.mjs#L111). This is intentional correction of the same task, not automatic history sharing between independent stages.
- **Seen:** Instructions, custom-agent prompts, configured MCP tools and provider defaults can be supplied through trusted host context. SDKs may also load their own configuration. This can add shared instructions/tool schemas to each request; “fresh” does not mean an empty system prompt. See [authoring context contract](../references/authoring.md#L5).
- **Seen:** The journal stores script/args and completed results for replay; it is not a summary of all native agent messages. See [run metadata](../scripts/runtime.mjs#L165) and [cached results](../scripts/runtime.mjs#L129).

## Pinned provider capabilities

### Claude Agent SDK 0.3.310

**Seen in the installed API:** `Options.resume` loads a specific session's conversation history; `forkSession: true` with `resume` creates a separate session. `resumeSessionAt` selects a chain point. The separate `forkSession(sessionId, options)` export copies transcript messages, supports `upToMessageId`, and returns a new session ID. Its declaration explicitly says file-history snapshots are not copied. See installed `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`: lines 844–878, 1743–1747, and 2122–2139.

The [official session guide](https://code.claude.com/docs/en/agent-sdk/sessions) independently confirms that continuing/resuming retains the conversation, forking starts from copied history, and conversation persistence is distinct from filesystem checkpointing. These primitives can implement an explicit alternative-exploration feature; they do not implement a result-only handoff by themselves.

### Codex SDK/CLI 0.164.0

**Seen:** The JavaScript SDK exposes `startThread` and `resumeThread`, with no public fork method in its pinned `Codex` class. The same thread records its native thread ID and supplies it on subsequent turns. This is supported both by the [tagged Codex SDK source](https://github.com/openai/codex/blob/rust-v0.164.0/sdk/typescript/src/codex.ts) and [thread implementation](https://github.com/openai/codex/blob/rust-v0.164.0/sdk/typescript/src/thread.ts), and installed `dist/index.js` lines 54–85 and 533–548.

**Seen, important distinction:** The installed CLI itself **does** support `codex exec fork <SESSION_ID> [PROMPT]`; `exec --help` and `exec fork --help` advertise it. Lack of a JS SDK fork method does not imply that ordinary native exec cannot fork. Autocode's SDK wrapper currently does not select that CLI subcommand.

**Seen:** The pinned app-server schema also exposes `thread/fork` and `thread/resume`. `ThreadForkParams` includes `threadId`, `beforeTurnId` (exclusive) and `lastTurnId` (inclusive; cannot target an in-progress turn). `excludeTurns` changes response hydration; it is not a promise to remove history from the model's context. `ThreadResumeParams.history` is explicitly unstable and marked for Codex Cloud, so it is not a suitable default transcript-injection API.

Evidence: `.scratch/native-protocol-pinned/ClientRequest.json`, definitions `ThreadForkParams`/`ThreadResumeParams`, generated from the installed binary with:

```sh
./node_modules/.bin/codex app-server generate-json-schema --experimental --out .scratch/native-protocol-pinned
```

Our optional app-server transport currently creates a new ephemeral thread using `thread/start`; it does not call these fork/resume methods. See [codex-app-server.mjs](../scripts/codex-app-server.mjs#L121). Forking native sessions was not executed in this research; capability availability here is declaration/help evidence.

## Token accounting and caching

**Seen:** Adapters expose reported output, input and cached-input usage through `onUsage`. The runtime records measured input/cached-input fields, but standalone `budget.spent()` and the shared ledger's automatic `charge(delta)` use reported **output tokens**, not total input cost or actual context occupancy. Missing usage remains qualified as incomplete. See [Codex usage](../scripts/codex-adapter.mjs#L132), [Claude usage](../scripts/claude-adapter.mjs#L91), and [runtime charging](../scripts/runtime.mjs#L389).

**Seen in the [official prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching):** Repeated matching prefixes can qualify for cached processing and lower input cost. **Inference for our workflow:** Stable shared instructions/briefs may benefit, subject to provider eligibility and routing. Cached input is still context presented to the model; a cache hit is not evidence that irrelevant history disappeared or reasoning improved. A journal cache hit for a completed logical call makes no new model request and incurs no new model tokens for that call. Conversely, continuing the same native agent can repeatedly present its own existing conversation as input. The runtime's prefix warm-up gate is not a history fork. Existing usage receipts do not constitute a fresh-versus-fork benchmark, and we cannot claim a percentage reduction in time, tokens or money from this research.

## Minimal policy recommendation

1. Keep fresh logical agents and explicit result-only handoffs as the workflow default. Do not add opaque parent-history forking to ordinary `pipeline()` or `agent()` calls.
2. Pass a small shared brief: task/scope, relevant constraints, current decisions, unresolved questions, and source/artifact references. Pass the completed stage's validated result, not its entire transcript.
3. Keep large outputs in appropriately scoped artifacts and read selected portions as needed. Validate result shape and preserve uncertainty, missing coverage, evidence and failures in that result.
4. Retain native conversation only for intentional continuation of the same task, including schema repair. Native compaction can help that agent's own long-running loop; it does not replace cross-stage context selection.
5. Consider explicit fork support only for competing alternatives from a stable, identified base. Define provider/session/checkpoint, permissions and source revision before branching. Do not promise disk rollback: coordinate edits separately with existing worktree/review behavior.
6. Before adopting fork as a performance optimization, compare matched tasks, models, permissions, tool routes and source revisions. Inspect input/cached/output counters and correctness, not just output-token budget. Until then, savings are unmeasured.

**Fresh-agent transport was not sufficient.** The inspected SF loop explicitly passed `history`, `{rt,history}`, `{rt,rtFix,history}` and `{rt,rtFix,qa,history}` and returned all history to the parent. It required a code correction, not just advice about document reads. The [review/fix template](../assets/templates/review-fix-loop.js) now passes an indexed open-finding ledger, current targeted fixer details, latest change references and report pointers. Closed result bodies stay out of later prompts and the parent result. Fix claims remain pending until independent same-subject QA. The matching SF script was corrected with its original preserved as `workflow.before-context-fix.js`; existing already-loaded executions were not restarted.

Native forks remain deferred while context passing is fixed first. A separate fork feature would require an explicit API and evaluation. The current correction preserves the task packet's required review scope; it does not claim to eliminate every necessary source read, enforce input-token spending or measure provider cost savings.
