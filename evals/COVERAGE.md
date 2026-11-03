# Coverage review — 2026-11-03

The review covers the current uncommitted source, not just the earlier 0.1.1 receipts. Tests and evals use **`claude-haiku-5-5` for Claude and `gpt-6-luna` for Codex** in this campaign. Terra was not evaluated. Historical receipts retain their original dates and models.

## Defects the review exposed and fixed

| Finding | Correction and evidence |
| --- | --- |
| Default progress labels replayed full prompts into the parent | Progress now reuses the already bounded, sanitized task label. A generated success/failure test excludes large historical prompt bodies from both progress events. |
| Failed Claude compaction could leave the watchdog suspended | Authoritative tracked `system/status` failure/success ends the active compaction on the same ID. A failure-then-silence regression proves bounded watchdog retries resume; private errors are not forwarded. |
| Two reviewers could agree on a stale hash after a newer QA fix and return clean | Closure now uses the latest known changed-subject hash, including the preceding round's QA fix. An observed failing regression covers both reviewers agreeing on the wrong old hash. |
| Empty/whitespace subject hashes and report paths could establish clean completion | Schema and stage-boundary validation require nonblank references. Seeded negative/property tests reject these before acceptance. |
| Fresh agents still received all prior result bodies in the SF loop | Current open-finding indexes and report references replace growing `history` payloads. Only the targeted fixer receives actionable current detail. Closed bodies also stay out of the parent result. The actual SF script and reusable template pass the same regressions. |
| A fixer claim or an omitted ID could erase unresolved work | Findings remain pending independent QA; `UNKNOWN` and omitted IDs preserve them. Reopened IDs use current evidence. Tests vary IDs, verdicts and omitted-ID behavior, not just discarded text. |
| The legacy authoring eval used unspecified SDK models | Its parent explicitly requests Luna and must observably read the checkout SKILL.md; trusted context forces Luna delegates. Wrong-model journal receipts fail. Requested/configured models remain separate from unavailable API-reported model metadata. |
| Its keyword oracle accepted a false finding containing bug words | The oracle now executes the unchanged fixture and requires the exact independent witness: `add(2,3)` should be 5 and actually is -1. Correct fixtures must pass; false witnesses must fail. |
| Live nonce recovery alone did not prove a report read | The stronger grader requires a successful original-report tool receipt containing the hidden nonce. It rejects model-only claims, wrong paths, failed reads, missing nonce output and inline echo. Authentic native receipts regrade both original attempts successfully without paid reruns. |
| Completion could be delivered before terminal state, or configured with one callback | The journal is durably terminal before notification; notification integrations require both callbacks before startup. Delivery errors preserve task outcome and never rerun work. |
| Detached CLI startup had no originating-host notification route | Bare `--background` is rejected. The skill/templates require an awaited return or a native host-owned background task delivering both outcomes. Native parent delivery has separate evidence below. |

## Evidence matrix

| Boundary | Deterministic evidence | Live evidence | Limit |
| --- | --- | --- | --- |
| Review/fix context passing | `tests/review-loop-context.test.mjs`: closed-body exclusion, compact pending index, current fixer details, reopening, omitted IDs/UNKNOWN, matching/stale hashes, blank references; seeded properties | Same public template on Luna and Haiku 5.5, five real calls per provider | Small fixture; not a full SF specification review or measured savings |
| Retrieval and independent closure | `tests/review-context-fixture.test.mjs`: positive oracle plus source-retirement, leak-placement, policy key-order, missing repair/retrieval, incorrect hashes/verdicts, history, extra writes and false tool-receipt controls | Real policy repair, report files, actual SHA256 checks, retired original evidence, fresh review recovering nonce via actual native report reads, final same-hash QA | Report retrieval, not arbitrary full native conversation search or forks |
| Model selection | Wrong-model receipt rejection and explicit parent/delegate selection tests | Context eval observes exact Luna native `turn_context` and exact Haiku API model fields; all observed models match | Configured journal fields alone are not independently reported API identity |
| Embedded discovery | Real-process CLI/API tests: custom directories, PID reuse/death, interrupted rows, readonly fallback, stale references, ownership changes and rejected live takeover | Both requested providers read a fresh hidden marker; active `ps` and completed status checked | Marker smoke does not establish context-loop behavior |
| Completion contract | `tests/completion-contract.test.mjs` plus actual CLI rejection: terminal-before-callback, callback-pair validation, error identity, no duplicate work | Native Codex Luna owner returned CLI success/failure to this originating session. Haiku native background owner emitted a matching task notification; parent read output after notification and returned verified outcomes | Claude proof is SDK engine lifecycle, not desktop UI rendering; native-owner hard-kill/reconnect was not injected |
| Authoring and execution | `tests/live-skill-eval.test.mjs`: valid witness acceptance, wrong witness/model rejection, shared parent/CLI deadlines | Corrected Luna-pinned authoring smoke passed actual authored-script CLI execution with three delegates | Current-source authoring and execution are separate; installed plugin autoload and full host integration are different evidence |
| Full integrated read-only task | Executable hidden counterexamples, correct decoys, source hashes and parallel/reviewer/verifier agreement | Historical native Codex Luna and Claude Haiku 5.5 passes in `full-task-results-2026-11-02.json` | Historical source; separate SDK-parent sandbox experiment is not the normal native Codex baseline |
| Compaction | Native-event adapters and runtime watchdog integration, including successful compaction longer than the test stall interval and failed compaction followed by silence | Engines' native compaction support inspected | No forced near-window live stress, exact threshold or recovery-success rate |
| Replay, schema, controls and recovery | Existing public-interface/property/process suites, malformed inputs, negative controls and the independent repeated replay witness | Earlier provider canaries plus the current matched live paths | Passing fixtures do not establish every provider failure mode or private host UI equivalence |

Live context results and authentic tool receipts: [review-context-results-2026-11-03.json](review-context-results-2026-11-03.json). Native parent delivery: [parent-completion-results-2026-11-03.json](parent-completion-results-2026-11-03.json). Corrected authoring smoke: [authoring-smoke-results-2026-11-03.json](authoring-smoke-results-2026-11-03.json).

The two context attempts passed the original oracle. Their original `result.json` files were retained unchanged. The strengthened 14-check grader used matching persisted native session records and wrote separate regrade receipts with original/result/session/source hashes. Its future in-stream receipt capture is implemented; its receipt helpers have deterministic positive and negative controls. The new capture wiring was not itself run in another paid campaign.

## Reproduce the focused live coverage

Run from the package root with disk-backed scratch storage and authenticated providers:

```bash
mkdir -p .scratch/npm-tmp
TMPDIR="$PWD/.scratch/npm-tmp" node evals/review-context-live.mjs --provider codex --model gpt-6-luna
TMPDIR="$PWD/.scratch/npm-tmp" node evals/review-context-live.mjs --provider claude --model claude-haiku-5-5
TMPDIR="$PWD/.scratch/npm-tmp" node evals/live-skill.mjs
```

Each context attempt has a finite deadline and preserves its project, prompts, native-model evidence, reports, source snapshots and grader outcome. Model mismatch or unavailable observation is not a model pass. No model fallback is performed in the matched context campaign. The authoring smoke reports unavailable API-model fields as null rather than inventing observations.

Native-parent probes used actual host lifecycle primitives and separate owned local fixtures. Their saved proof scripts/traces are referenced by the delivery receipt; they are one-off host integration evidence, not a portable desktop UI test suite.

## Coverage limits

No numeric percentage is a semantic success criterion. The current metrics below are loaded production JavaScript under the deterministic suite; they omit native engines, VM-authored template bodies and separately executed live entry points. Do not reuse the old October coverage percentages as current results.

Current verification: **340 tests passed, zero failures and zero skips** with four concurrent test files. Loaded `scripts/*.mjs` coverage is **99.24% lines, 86.57% branches and 87.05% functions**. The command and full report are retained in `.scratch/coverage-review-final-v3.log`:

```bash
TMPDIR="$PWD/.scratch/npm-tmp" node --test --experimental-test-coverage \
  --test-coverage-include='scripts/*.mjs' --test-concurrency=4 tests/*.test.mjs
```

This metric excludes hook `.cjs` files and the separately run live harness entry points. Lower branch coverage remains in process control (75.46%), CLI (80.16%) and native transport (81.67%). Uncovered lines include interactive TTY selection, exceptional native cleanup, missing-journal recovery and an unused compatibility wrapper. The review did not add line-only tests to claim 100%.

Unmeasured: full 208 KB SF-task quality after the context correction, native conversation forks/search, forced context-window overflow, hard monetary/input-token caps, production token savings and every host UI/version. These remain explicitly outside the claims above. The correction preserves the original SF packet's required review scope, so necessary full-specification reads still exist.

## Deployment scope

These campaigns execute checkout paths. The globally installed package was inspected separately and still has an older runtime (`4888aa4100fcedc0a63f5560b8a37db2ad2378bd2fb69c99e3d05806d5a57431`), so this report does not claim a global install or installed-host update. The source-authoring smoke now explicitly reads the checkout SKILL.md and rejects a missing read receipt. The actual SF scratch workflow was patched with a preserved original; existing executions were not restarted. Changed prompts can invalidate old replay entries, so these fixes do not imply an automatic safe continuation of an old live run.

There is no single new run combining model authoring, compact review/fix cycles, native background delivery and forced compaction. Those boundaries are evaluated separately. The successful historical full integrated task remains explicitly dated.
