# AUTO-01 replay identity handoff

Validated 2026-11-02 in upstream Autocode checkout, HEAD `723826be19934b2bba6331510be9ec33b101315e` **with uncommitted changes**. This is an upstream handoff, not a Factory release or copy-back receipt.

The tested runtime SHA256 is `cffb279c445766b5a00e6208bc3929fdd413184d58e985d28b2bd54c1094d3f4`. The runtime was already dirty when this follow-up began (assignment SHA256 `e90a5395c4e265a0e9d144bec26742305b29091b65d751356ada2c1b77547963`). Neither the HEAD alone nor this document identifies a committed release containing the fix. Later runtime changes require rehashing and rerunning the witness.

## Portable audit witness

The supplied `replay-regression.mjs` was run unchanged against two absolute runtime paths with disk-backed scratch under `.scratch/replay-audit/runs`.

| Runtime | SHA256 | parallel original → resumed | pipeline original → resumed | adapter calls per case | exit |
|---|---|---|---|---|---|
| Isolated unchanged HEAD runtime | `4888aa4100fcedc0a63f5560b8a37db2ad2378bd2fb69c99e3d05806d5a57431` | `[[1],[2]] → [[2],[2]]` | `[[1],[2]] → [[2],[2]]` | 2 | 1 |
| Dirty working runtime | `cffb279c445766b5a00e6208bc3929fdd413184d58e985d28b2bd54c1094d3f4` | `[[1],[2]] → [[1],[2]]` | `[[1],[2]] → [[1],[2]]` | 2 | 0 |

Full machine-readable outputs: `.scratch/replay-audit/before.json` and `after.json`. The baseline is exactly `git show HEAD:scripts/runtime.mjs`; its relative import `run-stats.mjs` was also extracted from HEAD without modifying runtime bytes. Full working-runtime diff against HEAD: `.scratch/replay-audit/runtime.diff` (includes earlier uncommitted parity implementation).

## Follow-up defect and fix

The earlier group identity fix solved repeated groups but its global replay flag made the first unfinished branch invalidate completed siblings. A failed first branch plus completed second branch resumed with adapter calls `['unfinished','completed','summary']`; the required calls were `['unfinished','summary']`.

Replay eligibility now belongs to each branch. Parallel/pipeline forks inherit their parent's eligibility independently; a cache miss disables only that branch. Joins propagate any invalidation to downstream work, and nested workflow completion propagates child eligibility. Existing upstream-failure/summary invalidation remains verified.

Changed in this follow-up: `scripts/runtime.mjs`, `tests/replay-interruption.test.mjs`, `tests/replay-interleaving.test.mjs`, `tests/replay-boundaries.test.mjs`, and this document. No Factory files changed and no commit was created.

## Compatibility and evidence

Version 2 journals resume, preserving completed results and previously reported usage. Legacy version 1 or absent-version journals are explicitly rejected before journal parsing/repair or adapter calls. Both metadata and journal bytes remain intact, including an ambiguous partial journal. There is no attempted silent collision recovery.

The final connected replay/journal/runtime/usage/worktree suite passed all 49 tests. Replay coverage includes 30 generated nested/repeated replay cases (seed `20261102`) and 30 generated nested interruption cases (seed `20261103`, failed branches across generated positions and completion delays). The focused interruption file passed all 3 tests. Coverage includes child ordering, repeated/nested groups, direct calls between groups, interleaved parallel/pipeline groups, changed options, partial journal recovery and export/import. Existing retries, usage and worktree checks ran in the connected suite.

Exact red/green evidence is in `.scratch/replay-audit/tdd.log`. The interrupted-group regressions failed before their fix. The other added boundary tests validate existing behavior; their red was not observed and is explicitly marked accordingly.

Run commands from this checkout:

```sh
node /home/john/go/src/github.com/agenthands/software-factory/docs/reviews/2026-11-02-audit-followup/autocode/replay-regression.mjs "$PWD/scripts/runtime.mjs" "$PWD/.scratch/replay-audit/runs"
node --test tests/replay-*.test.mjs tests/journal-*.test.mjs tests/provider-replay.test.mjs tests/properties.test.mjs tests/runtime.test.mjs tests/usage-parity.test.mjs tests/worktree-parity.test.mjs
```

These checks were run outside the tool sandbox because the restricted tool environment suppressed Node child-process output; this is execution evidence, not a skipped assertion. Live provider validation belongs to the overall parity run and was not repeated for deterministic replay tests. Factory INF-04, QA-F2, and PLAN-1 remain outside AUTO-01's upstream scope.

## Integrated runtime recheck

After recovery, spawn hooks, prefix coordination and provider/shared-ledger contract validation, embedded discovery and live-owner replay protection were integrated, the unchanged portable witness was rerun on runtime SHA256 `feb776697b9e61871fa95d731a5a9fef33cf8bd0a33d4bd45015cdf5ccbdc547`. Both helpers again preserved `[[1],[2]]` with two adapter calls, exit 0. Exact output: `.scratch/replay-audit/after-final.json`. This remains the dirty working tree at the HEAD identified above; no committed release or Factory installation is implied.

The final integrated suite passed 249 tests, with no failures or skips. Full current runtime diff is `.scratch/replay-audit/runtime-final.diff`.
