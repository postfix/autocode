# Autocode skill evals

`npm test` checks the workflow runtime, provider adapters through SDK fakes, package contents, and bundled templates. It also checks that skeptical verification rejects a false finding and that exhaustive review deduplicates findings, votes, and stops after dry rounds.

Run the source-authoring smoke from a machine with Codex subscription authentication and the pinned dependencies installed. It reads this checkout explicitly, so an older globally installed skill cannot stand in for the current instructions:

```bash
node evals/live-skill.mjs
```

The eval writes its project and run journal under the workspace's `.scratch/autocode-evals` directory, keeping heavy scratch work off RAM-backed `/tmp`. Set `AUTOCODE_EVAL_SCRATCH` to another disk-backed directory if needed. A sandboxed Codex SDK thread explicitly using `gpt-6-luna` reads the current checkout skill to author a workflow; then the harness runs that exact script through the Autocode CLI with three read-only Codex SDK agents forced to `gpt-6-luna`. Its independent oracle executes the fixed `add(2,3)` witness; keyword mentions alone cannot pass. The parent and CLI share a finite deadline. It checks the authored script, journal, result, and unchanged source file. The report prints the project path for inspection. No API key is required.

This harness tests skill authoring and execution as separate stages. The current live checks also passed a real nested Codex parent → CLI → SDK invocation using explicit network access for parent commands and private writable authenticated SDK state; see [the host contract](../USAGE.md#running-the-sdk-inside-another-codex-session) and [live evidence](live-parity-2026-11-02.json). Both providers, model switching and journal replay have separate live checks. An installed plugin's trust and lifecycle loading remain distinct from directly invoking its packaged hook commands.

After restoring the recovered subagent prompts, run a direct text-output check from a shell that permits the Codex SDK to initialize:

```bash
node scripts/autocode.mjs run assets/templates/parallel-scout.js --provider codex \
  --args '{"questions":["Return exactly TEXT_PROMPT_OK."]}' \
  --run-dir ../.scratch/autocode-evals/text-prompt
```

The `result[0].finding` should equal `TEXT_PROMPT_OK` and `failures` should be empty. The live skill eval's agents use structured schemas and exercise the restored `zs` prompt; this direct check exercises `Hs`.

## Full integrated task on both platforms

From this checkout with pinned dependencies and authenticated subscriptions:

```bash
node evals/full-task-codex.mjs --source-mcp
node evals/full-task-claude.mjs
```

The harnesses discover the requested Luna and Haiku 5.5 models, create isolated repositories, and ask one parent session to read the current skill, author a workflow, execute the actual CLI, inspect its results and return the verified report. Models are forced for delegated calls. The shared hidden oracle checks concrete counterexamples, four real defects, no false positives, parallel review followed by verification, and unchanged source files. Every attempt is retained under `.scratch/full-task-codex` or `.scratch/full-task-claude`.

The Codex command uses a narrowly allowlisted, read-only MCP source tool because pinned Codex 0.164's nested native Bash tool hits a daemon-directory masking bug. Running it without `--source-mcp` exercises that known failing native-Bash route. Neither mode changes the model or relaxes the sandbox. Claude performs a separate nested-execution preflight before its first blind task.

See [recorded results](RESULTS.md) and [machine-readable evidence](full-task-results-2026-11-02.json). Earlier failures are retained, not replaced by the passing runs.

### Native Codex platform correction

The automated `full-task-codex.mjs` script above is an SDK-parent nested-sandbox experiment. It sets `approvalPolicy: never`; it is not equivalent to the actual Codex environment's normal approved-command path. Its MCP workaround is not required for the native-platform task.

A fresh actual Codex Luna agent subsequently authored and executed the same task without MCP, using the normal authorized CLI invocation with read-only delegated agents. It passed the same hidden oracle. See the corrected results and execution receipt above. To reproduce this native-platform evaluation, use a Luna Codex session with normal command approvals, provide the shared `FULL_TASK` and schema, and approve the actual Autocode CLI launch; retain its workflow result and journal for `scoreFullTask`.

## Embedded workflow discovery

Run `TMPDIR="$PWD/.scratch/npm-tmp" node evals/embedded-discovery-live.mjs` from the package root after creating that disk-backed temp directory. This opt-in live check uses Luna and Haiku 5.5, writes a fresh unknown marker fixture, verifies actual file reads, and queries the real CLI during and after an embedded run. It incurs provider usage. Results are written to `.scratch/embedded-live-results.json`. The [2026-11-03 receipt](embedded-discovery-results-2026-11-03.json) records the successful both-provider run and the earlier Luna refusal. This is separate from context-window stress or fork benchmarking.

## Current coverage review and context-loop eval

[Coverage review](COVERAGE.md) distinguishes deterministic fixtures, real provider/model evidence and native parent delivery. The matched context-loop eval uses `gpt-6-luna` and `claude-haiku-5-5`, real repairs, independent same-hash QA and actual report-reference retrieval after the original nonce source is removed:

```bash
TMPDIR="$PWD/.scratch/npm-tmp" node evals/review-context-live.mjs --provider codex --model gpt-6-luna
TMPDIR="$PWD/.scratch/npm-tmp" node evals/review-context-live.mjs --provider claude --model claude-haiku-5-5
```

[Both first attempts passed](review-context-results-2026-11-03.json), with native Luna model records and Haiku API model fields. Original results are preserved; the stronger read-receipt oracle regraded them from matching native session records without paid reruns. [Native parent completion proofs](parent-completion-results-2026-11-03.json) and [the corrected Luna authoring smoke](authoring-smoke-results-2026-11-03.json) have separate scopes. No Terra, forced-overflow or fork-cost benchmark is claimed.
