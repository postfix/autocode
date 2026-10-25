# Skill eval results

Run date: 2026-10-25. Source version: Autocode 0.1.1 release candidate in this checkout.

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
