# Claude workflow prose versus active Autocode

Current audit: 2026-11-03. Source: recovered Claude Code 2.1.310. This compares the preserved source, required authoring instructions, emitted subagent prompts, templates and runtime behavior. It is not a claim of identical host UI or every provider capability. The earlier historical comparison is available in Git history.

## Preserved source and active delivery

All eight recovered prompt assets remain byte-identical to the recovery inventory; `tests/prose.test.mjs` verifies their hashes. Preserving a file alone does not establish delivery: the paths below describe what actually reads it.

| Source surface | Active Autocode path | Current behavior |
| --- | --- | --- |
| Default authoring reference | `SKILL.md` → `references/source-prompts/authoring.md`, plus required API/quality guides | Full original five recipes, pipeline-first guidance, verification patterns and worked examples are required reading. Autocode-specific execution differences explicitly take precedence. |
| Forced-model authoring variant | Packaged `authoring-forced-model.md`; host/provider defaults resolved by runtime | Forced models win over per-call choices. Standalone execution does not automatically inherit the parent session's model. |
| Workflow tool description/preamble | Preserved source files; `SKILL.md` supplies the actual author/run/control instructions | Authors save a script and invoke the CLI rather than calling Claude's native `Workflow` tool. |
| `Hs` default text prompt | `subagentInstructions(false)` used by both adapters | Original return contract retained; the unavailable `SendUserMessage` instruction is adapted to available channels. |
| `zs` default structured prompt | `subagentInstructions(true)` and adapter schema handling | Original structured-return intent retained. The author-facing contract is `schema`, not manually invoking a tool from workflow code. |
| `Js`/`Ks` custom suffixes | Trusted registry prompt plus active custom suffix in both adapters | Active, including an explicitly empty custom prompt. Custom structured wording names the supplied JSON schema. |
| Computed-task authority | Original prompt plus explicit instruction/permission qualification | System/developer instructions stay separate from task text. A computed workflow task does not grant permissions. |
| Full/keyword/sparse/exit reminders | `hooks/autocode-mode.cjs` loads `activation-reminders.json` | Full source wording retained with tool/path substitutions and explicit user budget/permission qualification. Standing reminder lifecycle has executable command tests. |

## Recipes, defects and rationale after re-review

The source names **Understand, Design, Review, Research and Migrate** as composable recipes. Fold, Fix and Triage are authored phase metadata, not a built-in merge template. Copying these labels would not reproduce an unseen merge workflow; authors supply its actual task and stages.

| Difference or previous rationale | Reassessment and current behavior | Why this remains or was fixed |
| --- | --- | --- |
| Basic review returned string findings | Fixed: `{file,line,description}` findings; JSON passed to verifier | Source coordinates are necessary evidence, not optional complexity. Outer `[{finding,verdict}]` result remains. |
| Basic review uses one verifier | Retained; skeptical uncertainty defaults false and reason must contain nonblank evidence | The recovered basic recipe itself uses one verification pass. Three independent lenses are available in the exhaustive template. |
| Basic failure reporting | Fixed: truthful topic counts and explicit unresolved skipped/failed verification | A missing result cannot establish reviewed scope or disprove a claim. Top-level failures remain inspectable. |
| Exhaustive file/line deduplication | Fixed: identity `[file,id]`, with stable violated-invariant IDs and all prior claims in finder prompts | Multiple independent defects can share a line. Stable IDs are a finder contract, not automatic semantic matching. |
| Default four-round cap | Removed; explicit caller caps remain and report incomplete coverage | Four rounds had no source-based justification. Convergence requires two successful dry rounds and a completeness verdict. Runtime limits still apply. |
| Missing verification treated as rejection | Fixed: incomplete panels remain `unverified`; preserve valid votes and retry missing lenses | Missing evidence cannot count as a negative vote. Critic receives rejected and unverified claims separately. |
| Failed discovery counted as dry | Fixed: failed topics remain coverage gaps until successful discovery | API/tool failure is not evidence that no defects remain. |
| Completeness critic could erase known failures | Fixed: known discovery/verification failures remain independently in unresolved gaps | A model summary cannot override known execution failure. |
| Count-loop example | Fixed undocumented argument, object-identity dedup, null access and silent truncation | Published code must run with documented inputs and disclose omitted findings/shortfalls. It remains a bounded-target recipe rather than a claim of exhaustive discovery. |
| Research sweep lacked deep reading | Fixed: deduplicate sources, deep-read each, then critique evidence and coverage | A list of sources is not researched evidence. Failed sweeps and unreadable sources remain gaps. |
| Empty custom prompt chose defaults | Fixed: explicit empty prompts still select custom suffixes | Empty is a valid explicitly supplied registry prompt, distinct from absent. |
| Structured custom suffix named unavailable tool | Fixed: names the supplied JSON schema | Authors declare `schema`; adapter/engine chooses its transport. Preserved source stays unchanged. |
| Skill command supplied wrong template arguments | Fixed `files` to `topics`; executable command test | First-run guidance must match the recommended runnable template. |
| Forced-model provider context could be bypassed by omitted provider in embedding | Fixed: nonempty provider configuration requires declared default or per-call provider | Silently guessing or ignoring provider policy is incorrect. The CLI already supplies a provider. |
| Fresh calls mistaken for compact context | Fixed: the review/fix loop passes an open-finding index and report references, with actionable detail only in targeted fixer packets | The SF loop explicitly rebuilt full prior-result context. Transport isolation alone was insufficient. The parent now receives a compact result too. |
| Optional/incomplete host completion delivery | Fixed: paired callbacks validated before startup; terminal state durable before callbacks; mandatory awaited/native-task launch contract in skill and templates | Run IDs and files do not wake the originating agent. Bare unattended CLI detachment is rejected. |
| Embedded runs missing from `ps` | Fixed: shared-runner registration, private read-only-project fallback, live PID/start checks and explicit host/CLI control labels | Discovery must work inside Codex/Claude, not only through a CLI supervisor. Stale journals do not prove liveness; ownership transfers must preserve the active run. |
| Shared ledger accepted invalid/async callbacks | Fixed sync safe-integer reads and synchronous charging, with explicit errors | A promise or NaN bypassed admission comparisons. The host still owns the authoritative accounting; this is not a hard cost cap. |

## Retained adaptations and excluded capabilities: rationale for each

| Difference | Rationale and boundary |
| --- | --- |
| Saved scripts and CLI instead of native `Workflow` tool | The standalone package has no access to Claude's private host tool. It implements the same author/run/result contract through its own entry point. |
| Explicit trusted parent context | Neither SDK automatically transfers the originating parent's exact loaded instructions, live MCP connections, permissions or model. Supported fields must be supplied by the host; SDK project loading is a separate source of context. Required authoring prose now states this. |
| Packaged forced-model authoring variant is not automatically selected | Runtime trusted forced model/effort settings determine execution before replay identity. The ordinary guide explains this; selecting a prompt file cannot enforce host policy. |
| Computed task does not grant authority | Task text must not override system/developer instructions or tool permission policy. Preserving source wording is not permission to elevate task authority. |
| Schema transport differs | Claude may internally use `StructuredOutput`; Codex uses strict native output or validated JSON text. Both validate against the original schema with bounded repairs. Manually naming Claude's internal tool would break portability. |
| Soft output-token budget and explicit shared ledger | Provider reports are usage observations; concurrent calls can overshoot and unreported usage stays unknown. Claiming a hard spend limit or inventing parent usage would be false. Explicit user budgets override recovered cost rhetoric. |
| Required originating-host completion delivery | Await the foreground/API return or use a native host-owned background task. Paired notification callbacks are required when used; bare CLI detachment is rejected because status files do not wake the main agent. |
| Version-2 journals; ambiguous legacy journals rejected intact | Replay needs branch and effective-policy identity. Guessing missing legacy history risks reusing wrong results. Journals preserve workflow results, not a provider's full conversation. |
| Phase titles and grouping use metadata | Names such as Fold/Fix/Triage describe a particular authored workflow. Hardcoding them would misrepresent other tasks. |
| Recipes rather than five dedicated template files | Source recipes are composable guidance. Actual examples include review, research, judge panels and pipelines; a filename per recipe is not a behavioral requirement. |
| Mixed-provider example | An Autocode addition required by the two-provider target. It does not replace recovered recipes. |
| Standing mode requires explicit host installation/trust | The package can ship hooks and full reminders, but cannot install itself into another host's permission/session lifecycle silently. |
| Unsupported provider-specific restrictions | Excluded by the user's explicit decision. Requested unsupported policies error before startup; ordinary supported calls run. No engine fork or Factory executor is implied. See [capability scope](REMAINING-PARITY-BACKEND.md). |
| Exact native UI, remote execution, other OSs and private provenance integration | Outside the approved Linux local target. These are explicit scope differences, not claimed implementations. |

The context-forking follow-up is recorded in [CONTEXT-FORKING-RESEARCH.md](CONTEXT-FORKING-RESEARCH.md): retain explicit result-only stage inputs by default; native forks preserve a chosen history prefix and are not automatic context reduction.

## Context-window overflow and handoff audit

**Seen in the recovered source:** Workflow supplies the assigned task, optional relay/provenance framing and host context. Its `zR` call does not supply full parent `forkContextMessages` or enable generic agent handback. Native `zR` runs the query loop with inherited system/user context and compaction-window policy. Stalled/lost-reply attempts get fresh agent IDs and the original assigned task. Workflow recovery restores its journal; the missing-journal fallback instructs the parent to read agent transcripts and hand-author a continuation.

Evidence: `autocode-readable/chunk-2pjf4p7s.js:2938–2978,3111–3134,3549–3590,4491–4537`; native `zR` in `unpacked/claude-unpacked/chunk-x3dkgs4r.js:19`. These are local reverse-engineering artifacts outside the published package.

**Seen in Autocode:** each live, uncached logical call creates a fresh provider conversation. Trusted instructions are sent above task text; prior workflow results must be explicitly included in later prompts. Schema repair retains the Codex thread or resumes Claude's session. Runner retries use the original task in a fresh attempt. Journals persist script, args, completed results and usage; they do not restore unfinished provider conversations or parent memory. The optional Codex app-server thread is ephemeral. Provider session IDs/transcripts are not a portable handoff artifact in this package.

**Native compaction evidence:** the pinned Claude engine enables automatic compaction by default and exposes completed `compact_boundary` events. The pinned Codex protocol exposes context-compaction items and compaction configuration; its actual threshold depends on native configuration/model. The runner relies on these engines, not a second workflow-level summarizer. The event-liveness and typed-overflow diagnostic gaps found here are corrected and tested. No automatic retry of an identical oversized prompt is added.

**Remaining limits:** exact originating-parent compaction settings are not automatically transferred. Neither source Workflow nor Autocode guarantees a successful automatic handoff of an unfinished delegate after overflow. The source's manual transcript fallback is richer than Autocode's completed-result journal; Autocode does not promise recovery of partial native reasoning/tool history. A parent should retain run/script/context references and explicitly author continuation tasks from completed evidence. See [author guidance](../references/authoring.md#context-and-compaction).

This is a static implementation comparison plus deterministic native-event/failure tests. It is not a live near-context-limit stress test, and it does not establish a compaction-success rate or exact threshold.

Behavioral fixes have observed red/green evidence in [the TDD ledger](../evals/parity-tdd.log). The source hash test verifies preservation, deterministic tests verify the actual snippets/prompts/templates, and earlier live evaluations verify the provider paths. This prose audit does not claim a new live model evaluation or exhaustive original-host equivalence.

Final verification: **340 tests passed**, zero failures/skips, with four concurrent files and loaded-script coverage of 99.24% lines / 86.57% branches / 87.05% functions (`.scratch/coverage-review-final-v3.log`). This is not whole-engine or live-harness coverage. The current independent replay witness passed. Release packaging is verified separately.

The matched public review/fix loop passed on exact observed `gpt-6-luna` and `claude-haiku-5-5`, including real repairs, report-reference retrieval and native tool-read receipts. Native parent completion proofs and the Luna-pinned authoring smoke are separate. See [coverage review](../evals/COVERAGE.md) for limits and source-bound receipts. No forced context-limit, native-fork or cost-savings benchmark is claimed. The actual SF script's eight regressions pass; its original is backed up and no existing execution was restarted.

Deployment scope: the checkout and SF scratch script are corrected; the older global installation was not replaced. See [coverage scope](../evals/COVERAGE.md#deployment-scope).
