# Ultracode activation prose in Claude Code 2.1.310

These are the distinct Ultracode instruction fragments recovered from [chunk-j0tbz6ra.js](/home/john/rev/package/unpacked/claude-unpacked/chunk-j0tbz6ra.js). The full authoring text is in [the rendered reference](/home/john/rev/package/ultracode-authoring-reference.md); the tool-level opt-in text is in [the rendered description](/home/john/rev/package/ultracode-workflow-tool-description.md).

The [JSON copy](/home/john/rev/package/ultracode-activation-reminders.json) is validated against the four original string literals.

| Trigger | Embedded instruction |
| --- | --- |
| Keyword in user prompt | “The user included the keyword "ultracode", opting this turn into multi-agent orchestration — use the Workflow tool to fulfill the request.” |
| Ultracode enters, full reminder | “Ultracode is on: optimize for the most exhaustive, correct answer — not the fastest or cheapest. Use the Workflow tool on every substantive task; token cost is not a constraint. See the **Ultracode** section and quality patterns in the workflow authoring reference. Solo only on conversational/trivial turns.” |
| Ultracode remains on, sparse reminder | “Ultracode is still on — use the Workflow tool; see the Ultracode section of the workflow authoring reference.” |
| Ultracode exits | “Ultracode is off — the Workflow tool's standard opt-in rule applies again.” |

The source's `$0r` state machine decides whether to issue a full, sparse, or exit reminder. `F0r` checks the keyword only on qualifying human typed prompts and emits a separate keyword request reminder.

[chunk-grs0nvea.js](/home/john/rev/package/unpacked/claude-unpacked/chunk-grs0nvea.js) also carries the short authoring preamble: “Before writing a script, load the `workflow-authoring` skill — the workflow authoring reference: script API and gotchas, resume, the **Ultracode** section, quality patterns, worked examples.” The runtime substitutes the skill name from `c0`; consult the source if that name differs in a build.
