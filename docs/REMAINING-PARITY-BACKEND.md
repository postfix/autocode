# Provider capability scope

The user chose optional provider restrictions: keep the native controls already implemented, and exclude provider-specific restrictions that the available execution interfaces cannot enforce. This updates the delivery target; it does not claim full parity with all 40 original requirements.

Ordinary runs do not require a new enforcement backend. Omitted restrictions and empty command clamps add no policy requirement. When a caller explicitly requests an unsupported restriction, the adapter returns a capability error before starting that provider; it never silently drops the request.

| Capability | Implemented scope | Explicitly excluded scope |
| --- | --- | --- |
| Custom agents | Trusted registry prompts and defaults on both providers; Claude tool pools | Codex custom tool pools that its transport cannot enforce |
| Tools and per-call denials | Existing provider tool surfaces; Claude native denials and trusted tool pools; Codex native Bash denial | Complete equivalence to the source session tool pool; arbitrary Codex tool denials or allowlists |
| Parent permissions | Claude trusted host permission callback, native controls and explicit host instructions | A universal Codex host permission callback covering every tool operation |
| Shell command clamps | Empty clamps are no restriction | Nonempty command clamps on either provider |
| Safety and provenance | Trusted spawn hooks, higher-priority instructions and prompt withholding | Native transcript/provenance classifier integration |

The pinned Codex 0.164 interfaces expose specific approvals, not a callback covering every native tool operation or a complete tool allowlist. Using its optional app-server transport preserves these capability boundaries. An unsupported policy request therefore remains an error even though unrestricted execution is available.

No engine fork or Factory executor project is part of this scope. The earlier proposal to choose between those backends is superseded by the user's capability-scope decision. No Factory changes are required to complete ordinary Autocode execution under this decision.

The status matrix retains partial original requirements 10, 13, 16, 17 and 20, and excludes unsupported command-clamp enforcement in requirement 18. Each entry separates its implemented behavior from the unsupported behavior excluded by the user. `full_parity` and `full_original_parity` remain false because the original comparison includes those exclusions, remote execution and other operating systems. They do not indicate a pending backend decision.

Autocode's live checks and the deterministic AUTO-01 witness do not close separate Factory INF-04, QA-F2 or PLAN-1 obligations. Those retain their own integration and installation evidence requirements; this scope change makes no claim about them.
