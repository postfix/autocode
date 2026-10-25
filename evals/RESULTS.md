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
