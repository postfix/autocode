# Workflow design and verification patterns

This is the working Autocode adaptation of the [recovered Ultracode authoring prompt](source-prompts/authoring.md). Read that full prompt before composing a workflow; use this guide and [authoring.md](authoring.md) for runnable examples and the packaged runner's API and limits.

## Keep stage context focused

A fresh `agent()` receives the prompt you build, not the previous agent's complete conversation. Pass the previous stage's validated result and relevant evidence references explicitly. Prefer concise conclusions, uncertainty and remaining gaps over raw tool logs; leave large outputs in artifacts and request selected reads. A native session fork copies an existing history prefix and is useful for deliberate alternative exploration, not the default way to hand off stage results. Same-agent tool loops and schema repair retain their own history. See the [source-grounded context comparison](../docs/CONTEXT-FORKING-RESEARCH.md).

## Choose the work shape

First inspect the task enough to identify the actual work list. Use `pipeline(items, ...stages)` when each item can move to its next stage independently. Use `parallel([...])` when a later decision needs *all* earlier results, such as global deduplication, a cross-item comparison, or stopping when the complete finding set is empty. A `parallel()` call waits for every branch. A pipeline has no barrier between items: one item's verification can start while another is still being reviewed.

For a large task, run separate bounded workflows for understand, design, implement, review, and verify when the host agent must inspect a phase's result before authoring the next. A single workflow can cover several deterministic stages. Keep synthesis and important decisions in the host agent when they depend on user goals or new evidence.

Examples of useful shapes:

- **Understand:** independent subsystem readers, then a map of the system.
- **Design:** independent candidate approaches, independent judges, then synthesis.
- **Review:** independent dimensions, finding-level skeptical verification, then confirmed findings.
- **Research:** independent search modes, deep reading, then a sourced synthesis.
- **Migrate:** discover exact sites, transform isolated items, then verify each result.

Do not add a barrier merely to flatten, map, or filter an item's result. Do those operations inside its pipeline stage. A barrier is useful when the next stage must compare across items. Give concurrent calls explicit `phase` labels so their progress groups stay correct. A callback that throws becomes `null` in `parallel()` or `pipeline()`; filter nulls and inspect the top-level `failures` list before claiming coverage.

## Repeated review and fix context

Use the [review/fix loop](../assets/templates/review-fix-loop.js) for Red Team → Fix → QA → Fix. Its task packet carries the scope and required instructions; this template changes payload selection, not review authority or required coverage. Fixers receive current actionable findings. Reviewers receive the open/pending finding ledger, latest change reference and compact report pointers. They can read a referenced report when evidence is missing; do not insert every prior result or reload all old reports by default.

A fixer saying `FIXED` leaves its findings pending independent verification. Only a clean QA PASS on the expected subject hash closes the ledger. Merely omitting a prior finding or reviewing a different hash cannot close it. The parent receives status, current unresolved findings and report references, not the entire history. Full results remain in reports and agent journal records. The round limit must be supplied explicitly. This does not introduce native history forking, lower mandatory review scope or enforce input-token cost caps.

## Verification patterns

**Adversarial check.** Give independent verifiers the concrete claim and supporting evidence. Ask each to try to falsify it. Use a structured verdict and reject a claim when the requested majority does not support it. Count missing or failed verdicts as unverified, never as agreement. For distinct failure modes, assign different lenses such as correctness, security, performance, and reproducibility instead of repeating one prompt.

**Judge panel.** Generate several genuinely different solutions. Have independent judges score them against the user's criteria, then synthesize the best choice while preserving any stronger ideas from the others. Use this when the solution space is broad; a mechanical task does not need a panel.

**Loop until dry.** For open-ended discovery, remember every candidate seen, including rejected ones. Stop after a chosen number of consecutive rounds with no *new* candidates. Deduplicate against the whole seen set so rejected candidates cannot reappear forever. Log the stop condition and any coverage limit.

**Multi-modal sweep.** Give separate scouts different search modes, such as by file/container, by content, by entity, and by time. Keep their initial searches independent. Merge and deduplicate their results before deciding what needs deeper inspection.

**Completeness critic.** Before reporting an exhaustive result, ask a final agent which modalities were skipped, which claims remain unverified, and which sources or files were unreadable. Feed concrete gaps into another bounded round. Report gaps that cannot be closed.

**Scale and budget.** Size the finder pool and verification votes to the user's request. A quick check needs fewer calls than a comprehensive audit. `budget.total` is an optional output-token admission target. A trusted host can supply a shared turn ledger; standalone runs count runner-owned reported usage. Guard budget loops with `budget.total !== null`; otherwise `budget.remaining()` is infinite. Concurrent calls can exceed the target before new calls stop. Respect the runner's 16-concurrent-agent, 1000-agent total, and 4096-item-per-call limits. If you sample, truncate, or skip retries, log the omitted scope.

For a fixed target, supply `target`, `maxRounds`, and a `findingsSchema` whose findings include `file`, `line`, and `title`. Stop on the count and inspect failures before deciding whether to repeat:

```js
const findings = [];
const seen = new Set();
for (let round = 0; round < args.maxRounds && findings.length < args.target; round++) {
  const batch = await agent(`Find new issues. Already seen: ${JSON.stringify(findings)}`,
    { schema: args.findingsSchema });
  if (!batch) {
    log('Discovery returned no result; stopping. Inspect failures or skipped calls.');
    break;
  }
  const fresh = batch.findings.filter(item => {
    const key = JSON.stringify([item.file, item.line, item.title]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const remaining = args.target - findings.length;
  if (fresh.length > remaining) {
    log(`Omitted ${fresh.length - remaining} additional unique findings after reaching target ${args.target}.`);
  }
  findings.push(...fresh.slice(0, remaining));
  log(`${findings.length}/${args.target} found`);
  if (!fresh.length || findings.length >= args.target) break;
}
if (findings.length < args.target) {
  log(`Stopped short of target: ${findings.length}/${args.target} found; ${args.target - findings.length} missing.`);
}
return findings;
```

For an output-token target, check `budget.total !== null && budget.remaining() > args.reserve` before each new batch. Stop on a dry round or an explicit round cap as well; a budget check alone cannot stop a loop when agents return few tokens.

## Worked workflow: review with skeptical verification

The packaged [review-and-verify template](../assets/templates/review-and-verify.js) is executable. It sends each topic to a finder and immediately verifies that topic's findings. It returns only findings with a positive structured verdict. Use an additional independent verdict per finding when the user requests stronger confidence. The [exhaustive-review template](../assets/templates/exhaustive-review.js) combines repeated discovery, deduplication, three verification lenses, and a completeness check that feeds concrete gaps into further discovery. Findings carry `{id, file, line, description}`; identity is `[file, id]`, so independent issues on one line survive. Finders must reuse the violated-invariant ID for paraphrases; the runtime does not infer semantic equivalence. There is no default round cap. An explicit `maxRounds`, exhausted budget, failed discovery or missing verification is reported as incomplete coverage. Inspect `status`, `stopReason`, `unresolvedGaps` and `unverified`, alongside top-level failures. Successful verification votes survive retries. The 1000-call runtime backstop remains explicit.

For global deduplication, a barrier is appropriate:

```js
const sweeps = await parallel(args.dimensions.map(d => () =>
  agent(d.prompt, { phase: 'Find', schema: args.findingsSchema })));
const all = sweeps.filter(Boolean).flatMap(result => result.findings);
const unique = [...new Map(all.map(f => [`${f.file}:${f.line}:${f.title}`, f])).values()];
const verdicts = await parallel(unique.map(f => () =>
  agent(`Try to refute this finding with evidence: ${JSON.stringify(f)}`,
    { phase: 'Verify', schema: args.verdictSchema })));
return unique.filter((_, i) => verdicts[i]?.real === true);
```

For an item-local review, use `pipeline()` instead so verification starts as soon as that item's review finishes. When a verifier needs the entire finding set for comparison, use the global barrier above.

## Worked workflow: judge panel

```js
export const meta = { name: 'design-panel', description: 'Generate and judge independent approaches' };
const angles = ['simplest implementation', 'lowest operational risk', 'best user experience'];
const candidates = await parallel(angles.map(angle => () =>
  agent(`Design ${args.feature} from the angle of ${angle}. Give tradeoffs.`, { phase: 'Design' })));
const proposals = candidates.filter(Boolean);
const judgments = await parallel(['correctness', 'cost', 'maintainability'].map(criterion => () =>
  agent(`Score these proposals for ${criterion} against ${JSON.stringify(args.criteria)}: ${JSON.stringify(proposals)}`,
    { phase: 'Judge' })));
return { proposals, judgments };
```

The host agent should compare the judgments, choose a proposal, and combine useful ideas from others. Each panel member sees the same user criteria but develops its candidate independently.

## Worked workflow: multi-modal research and completeness

```js
export const meta = { name: 'research-sweep', description: 'Find sources, deep-read them, and check coverage' };
const modes = ['files', 'content', 'entities', 'timeline'];
const sweeps = await parallel(modes.map(mode => () =>
  agent(`Find canonical source references for ${args.question} by ${mode}.`, {
    phase: 'Sweep',
    schema: { type: 'object', properties: { sources: { type: 'array', items: { type: 'string' } } }, required: ['sources'] },
  })));
const sources = [...new Set(sweeps.filter(Boolean).flatMap(sweep => sweep.sources))];
const reads = await pipeline(sources, source =>
  agent(`Read source ${source} for ${args.question}. Cite concrete evidence; mark unreadable=true when access fails.`, {
    phase: 'Read',
    schema: { type: 'object', properties: { source: { type: 'string' }, evidence: { type: 'string' }, unreadable: { type: 'boolean' } }, required: ['source', 'evidence', 'unreadable'] },
  }));
const material = reads.filter(Boolean);
const missingModes = modes.filter((_, index) => sweeps[index] === null);
const unreadableSources = sources.filter((_, index) => reads[index] === null || reads[index].unreadable);
const knownGaps = [...missingModes.map(mode => `Search mode failed: ${mode}`), ...unreadableSources.map(source => `Source unreadable: ${source}`)];
const critique = await agent(`Find missing modes and unsupported claims in ${JSON.stringify({ material, knownGaps })}`, {
  phase: 'Check',
  schema: { type: 'object', properties: { summary: { type: 'string' }, gaps: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'gaps'] },
});
const unresolvedGaps = [...new Set([...knownGaps, ...(critique?.gaps ?? ['Completeness check returned no result'])])];
return { material, critique, unresolvedGaps };
```

The host agent should inspect the critique, investigate material gaps, and synthesize with citations. A critic's claim is a lead to verify, not proof that a source was actually checked.

## Agent return contract

An `agent()` result is data returned to its workflow script. Ask for the exact output shape: plain text for narrative data or a root-object JSON Schema for structured data. The adapters instruct agents to complete only their assigned task, return the requested result directly, and omit status confirmations or Markdown fences. Authors request objects with `schema`; they do not invoke a structured-output tool from workflow JavaScript. The Claude adapter reads the SDK's `structured_output` result; its native SDK can use `StructuredOutput` internally. Codex uses strict structured output where representable and validated JSON-text fallback otherwise. Both adapters validate the original schema and perform bounded repair before returning a result. A task calculated by the workflow still has to be checked against the user's permissions and the agent's available tools.

## Recovery mapping and limits

| Recovered prompt surface | Active Autocode use |
| --- | --- |
| Default and forced-model authoring references | This guide and [authoring.md](authoring.md); choose provider, model, and effort per call. |
| Workflow tool descriptions | `SKILL.md` supplies the opt-in boundary and workflow invocation. |
| Authoring preamble | `SKILL.md` requires reading both references before writing a workflow. |
| Text and structured subagent prompts | Both SDK adapters apply the return contract above. |
| Keyword reminder | Explicit `$autocode` or workflow requests activate the skill. The optional plugin hook also scans qualifying human prompts for `ultracode` and injects a one-turn reminder. |
| Full enter, sparse continued, and exit reminders | The optional Codex/Claude plugin hook persists `autocode on` mode per session, emits a full entry reminder, a sparse reminder after ten human turns or on resume, and an exit reminder for `autocode off`. Skill-only installs have no session hook. |
| Shared subagent authority note (`jn`) | Workflow-computed tasks are followed within the usual instruction hierarchy and permissions. |
| Default text prompt (`Hs`) and custom-agent text suffix (`Js`) | Both SDK adapters apply the preserved return contracts; custom types resolve from the trusted host registry, subject to provider capability checks. |
| Structured-output prompt (`zs`) and custom-agent suffix (`Ks`) | Both adapters return validated root objects through `schema`. Claude may use its internal `StructuredOutput` tool; Codex may use validated JSON text when strict transport cannot represent the schema. |
| Worked examples and quality patterns | The sections above plus packaged runnable templates. |

The [recovered prompt assets](source-prompts/) are included in this candidate package. [The prose comparison](../docs/PROSE-DIFF.md) lists the original versus active instructions and the SDK-specific subagent substitutions. Autocode changes tool invocation, output-schema mechanism, session activation, budget semantics, and provider options to match its implementation. Those differences must not be represented as exact Claude Code behavior.
