# Ultracode to Autocode parity

This compares the recovered Ultracode instruction surfaces from Claude Code 2.1.310 with Autocode 0.1.1. The source inventory and extracted modules live in the investigation workspace at `autocode/references/source-prompts/INDEX.md` and `autocode/references/recovered-code/INDEX.md`; they are not shipped in this public repository. “Adapted” means the operational instruction is present in Autocode's own wording and API. It does not mean byte-for-byte prompt reuse.

## Prose and prompt surfaces

| Recovered surface | Autocode 0.1.1 | Difference |
| --- | --- | --- |
| `Edo()` authoring reference, default model | `SKILL.md`, `references/authoring.md`, `references/quality-patterns.md` | Work-list scouting, pipeline versus barrier, verification, completeness, loops, caps, and resume guidance are active. The original full prose and Claude-only tool directions are not shipped verbatim. |
| `Edo()` forced-model branch | Per-call `provider`, `model`, and `effort` guidance | Autocode can choose Codex or Claude per call; it does not reproduce Claude's forced-model prompt branch or inheritance rules exactly. |
| Workflow tool descriptions (`l`, `J8s`) | Skill invocation and CLI usage | Explicit user opt-in and deterministic orchestration remain. There is no native Claude `Workflow` tool call, background task notification, or `/workflows` UI. |
| Authoring preamble | `SKILL.md` requires both authoring and quality references | Autocode loads its own references rather than Claude's `workflow-authoring` skill. |
| Text subagent prompts (`Hs`, `Js`) | SDK adapter instructions | Agents return the requested data to the script, without status chatter. Custom `agentType` suffix is inapplicable because `agentType` is unsupported. |
| Structured subagent prompts (`zs`, `Ks`) | SDK-native schema options | Codex and Claude use their SDK structured-output APIs; agents do not call Claude's `StructuredOutput` tool. Codex schemas are normalized to its strict object form. |
| Shared computed-task note (`jn`) | SDK adapter instructions | The task is followed under the normal instruction hierarchy and permissions; computed text does not gain user authority. |
| Keyword reminder (`F0r`) | `$autocode` or explicit workflow request | No global keyword scanner injects a system reminder. |
| Enter, sparse, exit reminders (`$0r`) | Task-scoped skill instructions | No persistent Ultracode on/off state or periodic reminder injection. |
| Recovered worked examples and quality prompts | `references/quality-patterns.md` and four executable templates | The review, skeptical verification, sweep, judge panel, loop, and completeness decisions are represented. Examples use Autocode's API and are not text-identical to Claude's examples. |

The active guide covers the recovered workflow decision patterns, but the exact recovered prompt corpus remains only in the investigation workspace. Autocode's instructions also add cross-provider selection and explicit inspection of the runner's `failures` output.

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
| Background Workflow UI and session activation FSM | Missing | The CLI streams progress and returns a result, without Claude's notification or mode reminders. |

## Validation and remaining risk

The local suite tests the runner, SDK adapter contracts, release package, templates, and property-based invariants. The live skill eval in `evals/live-skill.mjs` passed skill authoring and a separately launched three-agent Codex workflow that found and verified a seeded arithmetic bug. A fully integrated run from inside a sandboxed Codex host failed when nested Codex SDK processes could not initialize their state. The review workflow succeeded when launched directly through the CLI. See `evals/RESULTS.md`.

Autocode therefore has substantial workflow and authoring-pattern coverage, but **does not have full Ultracode parity**. The largest prose gap is session-wide activation/reminder injection. The largest execution gap observed locally is nested SDK startup from a sandboxed host. No percentage parity or 100% behavioral coverage is claimed.
