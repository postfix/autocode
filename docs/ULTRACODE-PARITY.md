# Ultracode to Autocode parity

This compares the recovered Ultracode instruction surfaces from Claude Code 2.1.310 with the Autocode 0.1.1 candidate. The [recovered prompt assets](../references/source-prompts/) are packaged; extracted bundle modules remain in the investigation workspace. [PROSE-DIFF.md](PROSE-DIFF.md) gives the detailed comparison for every recovered prompt surface, including all subagent variants. “Adapted” means the tool-specific wording changes for Autocode's SDK and CLI interfaces; it does not mean byte-for-byte execution of every prompt.

## Prose and prompt surfaces

| Recovered surface | Autocode 0.1.1 | Difference |
| --- | --- | --- |
| `Edo()` authoring reference, default model | `SKILL.md`, `references/source-prompts/authoring.md`, `references/authoring.md`, `references/quality-patterns.md` | Full source prose is shipped and the skill directs agents to read it. The compatibility guide overrides unavailable Claude-only tool directions. |
| `Edo()` forced-model branch | Per-call `provider`, `model`, and `effort` guidance | Autocode can choose Codex or Claude per call; it does not reproduce Claude's forced-model prompt branch or inheritance rules exactly. |
| Workflow tool descriptions (`l`, `J8s`) | Skill invocation and CLI usage | Explicit user opt-in and deterministic orchestration remain. There is no native Claude `Workflow` tool call, background task notification, or `/workflows` UI. |
| Authoring preamble | `SKILL.md` requires both authoring and quality references | Autocode loads its own references rather than Claude's `workflow-authoring` skill. |
| Text subagent prompts (`Hs`, `Js`) | `references/source-prompts/subagent-prompts.json`, `scripts/subagent-prompt.mjs` | `Hs` is loaded for actual text calls, substituting only the `SendUserMessage` line. `Js` is preserved but inactive because `agentType` is unsupported. |
| Structured subagent prompts (`zs`, `Ks`) | Same prompt source and SDK schema options | `zs` is loaded for schema calls; five `StructuredOutput` phrases are translated to SDK structured-result language. `Ks` is preserved but inactive. |
| Shared computed-task note (`jn`) | Included verbatim in active `Hs` and `zs` | A separate permission qualification is appended; computed task text still does not grant new authority. |
| Keyword reminder (`F0r`) | Optional Codex/Claude plugin `UserPromptSubmit` hook | Scans qualifying human prompts for `ultracode` and emits a one-turn reminder. Hook installation and host delivery remain unverified. |
| Enter, sparse, exit reminders (`$0r`) | Optional plugin `SessionStart` and `UserPromptSubmit` hooks | Per-session mode and ten-turn sparse reminders are implemented and locally tested. Host delivery and exact source state-machine parity remain unverified. |
| Recovered worked examples and quality prompts | `references/quality-patterns.md` and four executable templates | The review, skeptical verification, sweep, judge panel, loop, and completeness decisions are represented. Examples use Autocode's API and are not text-identical to Claude's examples. |

The candidate package preserves all identified prompt/prose assets and actively loads the original default authoring reference and the text/structured subagent variants. Autocode's instructions add cross-provider selection and explicit inspection of the runner's `failures` output.

## Runtime behavior

| Capability | Status | Evidence or limit |
| --- | --- | --- |
| JavaScript `agent`, `pipeline`, `parallel`, `phase`, `log` | Implemented | `scripts/runtime.mjs`; pipeline advances each item independently and parallel waits for all branches. |
| Nested saved workflow | Implemented with one-level limit | `scripts/runtime.mjs` and `scripts/autocode.mjs`. |
| Resume completed calls | Implemented | `run.json` and `journal.jsonl` cache successful calls by branch history, prompt, and relevant options. This is an adaptation of the recovered replay behavior. |
| Concurrency and item limits | Implemented | Up to 16 concurrent agents, 1000 calls per workflow, 4096 items per parallel or pipeline call. |
| Codex and Claude delegation | Implemented through native JavaScript SDKs | Mixed providers can be chosen per call. Live Codex delegation has passed; live Claude success remains unverified. |
| Structured output | Implemented with different mechanisms | Provider SDK schemas replace Claude's `StructuredOutput` tool. A live eval found and fixed Codex's strict object-schema requirement. |
| Token budget | Partial | Autocode stops starting calls at a soft output-token target; Ultracode's recovered reference describes a hard shared turn-token ceiling. |
| Worktree isolation and custom agent types | Missing | Both adapters reject `isolation: 'worktree'` and `agentType` explicitly. |
| Session-connected MCP tools | Partial/unknown | Autocode does not explicitly forward the host's MCP tool pool; Claude SDK calls use a limited file-tool list. |
| Background Workflow UI | Missing | The CLI streams progress and returns a result without Claude's notification or `/workflows` UI. |
| Session activation FSM | Partial | Optional plugin hooks implement keyword/full/sparse/exit reminders; local tests pass, but installed-host behavior remains unverified. |

## Validation and remaining risk

The local suite tests the runner, SDK adapter contracts, release package, templates, and property-based invariants. The live skill eval in `evals/live-skill.mjs` passed skill authoring and a separately launched three-agent Codex workflow that found and verified a seeded arithmetic bug. A fully integrated run from inside a sandboxed Codex host failed when nested Codex SDK processes could not initialize their state. The review workflow succeeded when launched directly through the CLI. See `evals/RESULTS.md`.

Autocode therefore has substantial workflow and authoring-pattern coverage, but **does not have full Ultracode parity**. The custom-agent suffixes remain inactive, and the optional hook has not been verified inside installed hosts. The largest execution gap observed locally is nested SDK startup from a sandboxed host. No percentage parity or 100% behavioral coverage is claimed.
