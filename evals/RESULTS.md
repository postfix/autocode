# Current context and completion coverage — 2026-11-03

The [coverage review](COVERAGE.md) found and fixed stale-hash/blank-reference false-clean cases, unpinned authoring models and a weak keyword oracle. The current deterministic suite passes 340/340, zero skips. Line/branch figures are explicitly limited to loaded production scripts.

The public review/fix template passed five real stages each on `gpt-6-luna` and `claude-haiku-5-5`: actual policy repair, independently checked SHA256 closure, compact next-stage/parent payloads and hidden evidence recovered from a referenced report. Exact models and genuine native report-read receipts are retained in [the matched results](review-context-results-2026-11-03.json). These are functional evaluations, not SF-scale quality or cost measurements.

[Native parent delivery](parent-completion-results-2026-11-03.json) passed actual foreground CLI success/failure under a native Codex background owner and a Haiku native background owner. Claude's matching task notification preceded the parent's output read. The proof is native lifecycle behavior, not desktop UI rendering or killed-owner fault injection. The [Luna-pinned authoring smoke](authoring-smoke-results-2026-11-03.json) also passed; its configured-model fields are not mislabeled as API observations.

Earlier receipts below are preserved historical evidence, not reruns of every current behavior.

---

# Corrected native-platform result — 2026-11-02

The actual native Codex environment also passed without MCP file access. A fresh Luna agent read the current skill, authored the workflow, executed the actual CLI using the normal approved-command path, and returned the verifier's report. All three delegates remained read-only and used forced `gpt-6-luna`. The independent hidden oracle verified all four defects, no false positives, unchanged source, parallel reviewers followed by skeptical verification, and matching verifier/workflow/parent reports. Native command/file-tool execution is recorded in the journal.

The first restricted CLI initialization failed; the normal authorized execution succeeded. Both are retained in `.scratch/full-task-native-codex/run-6kIf7a/execution-receipt.json`; the independently graded result is `.scratch/full-task-native-codex/result.json`.

**Current platform results:** native Codex/Luna passed without MCP, and Claude/Haiku 5.5 passed with native Read. The earlier SDK-parent harness forced `approvalPolicy: never` inside another sandbox. Its failure and MCP workaround are separate experiments, not the baseline native Codex result. Describing that workaround as the only Codex pass was misleading.

[Updated machine-readable results](full-task-results-2026-11-02.json).

---

# Full integrated task results — 2026-11-02

Both requested platforms completed a single-parent author-and-execute task using the current skill and actual CLI. The fixture is a seven-module billing/cart repository with a product specification, four known defects and two correct decoys. Two independent reviewers run in parallel, followed by skeptical verification. A hidden oracle executes every reported counterexample and checks original source hashes and agreement between verifier, workflow and parent reports.

| Platform/model | Outcome | Verified defects | False positives | Real delegates | Source unchanged |
| --- | --- | --- | --- | --- | --- |
| Codex / `gpt-6-luna` | Passed using read-only MCP file access | 4/4 | 0 | 3 | Yes |
| Claude / `claude-haiku-5-5` | First blind task passed with native Read | 4/4 | 0 | 3 | Yes |

Luna's first native-Bash attempt failed: the pinned Codex engine masks its daemon rendezvous directory inside the parent sandbox, preventing child command tools from reading files. That failed attempt remains recorded. The second attempt used existing MCP forwarding with an allowlisted read-only source reader, 21 real file reads with matching hashes, the same Luna model and unchanged sandboxes. No oracle answers or quality feedback were supplied. This does not establish that nested native Bash works.

Claude's separate infrastructure probes found a harmless exit-status suffix rejected by the evaluation command policy and a real CLI cleanup bug on read-only `/tmp`. The policy now accepts finite benign command forms; cleanup only removes sockets actually created. Both original failures remain preserved. After the probes, the first blind task passed without quality retries. Parent API messages report Haiku 5.5; delegate selection is verified by forced configuration and journal records, without independent retained delegate API transcripts.

[Machine-readable results and evidence paths](full-task-results-2026-11-02.json). These are bounded functional evaluations, not exhaustive production-repository coverage or a speed/cost comparison.

---

# Skill eval results

Run date: 2026-10-25. Source version: Autocode 0.1.1 release candidate in this checkout.

## Prompt restoration rerun

After loading the recovered `Hs` and `zs` prompt variants and packaging the complete authoring reference:

| Check | Result |
| --- | --- |
| Eight copied prompt/prose assets | Byte-for-byte `cmp` against the local recovery inventory passed. |
| Unit and property suite | 11 test files passed with `npm test`; adapter tests assert the actual text and structured prompts sent to both SDKs, and a prose test pins the hashes of all eight recovered assets. |
| Prompt module coverage | `scripts/subagent-prompt.mjs`: 100% lines, branches, and functions. Whole suite: 93.12% lines, 78.34% branches, 89.66% functions. This is not 100% repository coverage. |
| npm candidate file check | `npm pack --dry-run --json` and `verify-release.mjs v0.1.1` passed. |
| Installed candidate runner | The final local 0.1.1 tarball was installed into `~/.local`; `autocode run` returned `INSTALLED_OK` with no failures. The installed skill and `subagent-prompts.json` match the checkout byte for byte. |
| Live Codex skill authoring plus three structured agents | Passed: author saved `review.js`; two reviewers and a skeptical verifier confirmed `add(a,b)` returns `a-b`. Run `wf_3e326238-20d7-4b6c-9ac7-636e361bd9f6` in `/home/john/rev/package/.scratch/autocode-evals/run-tGLIYK`. |
| Live Codex text agent | Passed: returned exactly `TEXT_PROMPT_OK` with no failures. Run `wf_a4329c14-097b-4a57-8208-0d3a467d9d98` in `/home/john/rev/package/.scratch/autocode-evals/text-prompt-20261025`. |
| Sandbox-only first attempt | Failed with `Read-only file system` during Codex SDK initialization; the authorized retry outside that sandbox passed. |
| Installed Codex hook | Passed in read-only CLI threads: `autocode on` wrote `on:true`, a resumed `autocode off` wrote `on:false`, and a qualifying `ultracode` prompt injected the one-turn reminder into the session transcript. The two Autocode hooks were then trusted individually through Codex's hook review UI. A subsequent ordinary CLI thread, without any trust bypass, contained the full reminder and returned `TRUSTED_HOOK_OK`. |
| Installed Claude hook | Passed at the hook layer: `autocode on` and a resumed `autocode off` changed the plugin's session state from true to false. Claude model calls failed before inference because this organization has disabled Claude subscription access for Claude Code. |
| Live Claude subagent output | Unverified because Claude subscription model access is disabled for this organization. |
| Ten-turn sparse reminder in an installed host | Unverified; the pure transition test passes. |

The structured live run exercises `zs` through the Codex SDK; the text run exercises `Hs`. They demonstrate behavior for those two fixtures, not equivalence of every recovered sentence.

| Check | Result |
| --- | --- |
| Unit, property, template, adapter, and package tests | 9 test files passed with `npm test`. |
| GitHub release workflow preview | [Run 40219424499](https://github.com/postfix/autocode/actions/runs/40219424499) passed on the prompt-guidance commit; packaging changes after this run require another preview. |
| Live `$autocode` authoring | Passed: Codex saved a workflow with two independent reviewers and skeptical verification. |
| Live native Codex SDK execution | Passed: three delegated calls completed, no failures; run ID `wf_cd071afe-707a-485c-aa49-a8d4fb18bb6e`. |
| Seeded defect | Passed: the result identified `add(a,b)` returning `a-b` and verified the mismatch with a concrete example. |
| Source unchanged | Passed. |
| Integrated nested SDK inside sandboxed Codex host | Failed: child Codex could not initialize its app-server state (`Read-only file system`), including with a dedicated writable Codex state directory. |
| Live Claude SDK success | Unverified: the earlier account run hit a usage limit. |

The passing two-stage eval fixture and journal are in `/home/john/rev/package/.scratch/autocode-evals/run-LIge0u`. The eval harness writes future runs under that disk-backed scratch directory by default. The passing test proves skill authoring and direct runner execution separately; it does not establish that an ordinary sandboxed Codex host can run nested SDK agents without a permitted execution environment.
