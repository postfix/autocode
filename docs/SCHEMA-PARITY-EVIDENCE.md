# Schema and prompt-prefix follow-up evidence

Date: 2026-11-02. Public seams: provider adapters and `runWorkflow`, as approved for sf-tdd implementation. Fake SDKs below are external provider boundaries, not internal implementation mocks.

## Schema behavior

The supported dialect is JSON Schema draft7 with pinned AJV8.20.0 and ajv-formats3.0.1. Unknown assertion keywords, unsupported declared dialects and unknown formats fail preflight explicitly; newer dependentRequired/dependentSchemas assertions are not silently ignored. Standard annotations remain supported. The original schema is compiled before starting a provider and validates every decoded result. Codex's strict transport preserves omission using presence/value objects. Object `anyOf` and `oneOf` branches use closed tagged envelopes (`branch`, `value`), allowing each branch to decode independently before validating the original union. Original `oneOf` exclusivity remains enforced. Local references and nested optional fields are covered, including 50 generated reference-union examples and 50 generated primitive-union examples.

Valid schemas outside the native strict representation use JSON-text transport: object composition with assertion siblings, object `allOf`, boolean schemas, tuple items, object type unions, object const/enum values, unconstrained types, explicitly open objects and unknown native-schema keywords. The original schema is included in higher-priority instructions; JSON.parse and the original AJV validator run before any result returns, with the same three repair attempts. Native-compatible schemas retain strict transport through a conservative keyword allowlist. Primitive oneOf uses native anyOf followed by original oneOf validation. The official [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) lists allOf, not, dependentRequired, dependentSchemas, if, then and else as unsupported native compositions; all route to text fallback. Flattening `allOf` is unsafe in general: separately closed object branches and overlapping optional/required properties change intersection semantics when merged, so fallback preserves the original schema instead. Earlier refusal regression tests below document the intermediate safety fix; current tests assert successful validated fallback for those examples.

Recovered `../unpacked/claude-unpacked/chunk-gmxe4kpt.js`, functions `Ve` and `We`, establish the original cheap contradiction lint. Implemented checks reject excluded required properties (accounting for patternProperties), crossed required numeric/string/array bounds, and required integer intervals containing no integer. Traversal follows required object properties only, skips nullable schemas/references and stops at depth 32. Optional impossible properties remain permissible. AJV rejects invalid schemas, including an empty enum, before startup. This is bounded lint, not a satisfiability solver.

Both schema repair output usage and Codex input/cache usage accumulate across turns. Native exec Codex SDK `TurnCompletedEvent` exposes usage only; its `run()` returns items/finalResponse/usage. No native stop reason is fabricated.

Live Codex public-adapter canary passed with the configured default model: answer `oneOf` integer or a closed object with required kind='text' and optional note. Result was `{"answer":{"kind":"text"}}`, outputTokens=89, correctly omitting note. Scratch directory was removed in finally. An initial explicit gpt-5.4-mini request was rejected as unsupported for the ChatGPT account; the configured-model retry passed. Recorded in `evals/live-parity-2026-11-02.json`.

## Prompt-prefix coordination

Recovered `../ultracode-readable/chunk-2pjf4p7s.js:1571` (`kr`) and call sites at 2953, 3146, 3206, 3485 establish first-response coordination: a same-prefix sibling waits at most 5 seconds; a real model response warms the prefix for 270 seconds; failed leaders release followers. No arbitrary startup sleep is used. The prefix distinguishes provider/model/effort/agent type/schema/tool restrictions/cwd and trusted host id/revision. Workflows using the same trusted host object share coordination. Standalone workflows use their own gate. Different prompts with the same prefix share the gate. Distinct model or host revision prefixes remain independent.

Codex turn.started does not mark a response. Model output and model tool requests do; a nonstream injected SDK can only notify after its run returns. The stall watchdog starts after the warm-up wait. Environment disable/cap settings mirror the recovered names. Claude first-response notification is implemented and verified separately by the root worker.

## Observed TDD cycles

All commands below ran outside the local sandbox because its child-output restriction obscures failure details. No schemas or credentials were sent to documentation services.

```text
tdd: Codex rejects object composition that strict transport cannot preserve before provider startup — red: 'Error: provider must not start' (expected /Codex.*composition/) — green: node --test tests/schema-parity.test.mjs passed
tdd: schema preflight permits required properties accepted by patternProperties — red: TypeError: unsatisfiable JSON Schema: required property is excluded by additionalProperties:false — green: node --test tests/schema-parity.test.mjs passed
tdd: Codex rejects boolean subschemas before provider startup instead of erasing them — red: 'Error: provider must not start' (expected /Codex.*boolean/) — green: node --test tests/schema-parity.test.mjs passed
tdd: Codex rejects object type unions before provider startup — red: 'Error: provider must not start' (expected /Codex.*object type unions/) — green: node --test tests/schema-parity.test.mjs passed
tdd: schema preflight rejects crossed bounds on required values without rejecting optional impossible values — red: 'Error: provider must not start' (expected /unsatisfiable.*bounds/) — green: node --test tests/schema-parity.test.mjs passed
tdd: Codex rejects unsupported array item schemas before provider startup — red: 'Error: provider must not start' (expected /Codex.*(boolean|tuple)/) — green: node --test tests/schema-parity.test.mjs passed
tdd: Codex decodes tagged object union branches and preserves optional nested fields — red: TypeError: Codex structured output cannot preserve object schema composition — green: node --test tests/schema-parity.test.mjs passed
tdd: schema preflight rejects crossed required string bounds — red: seed 2601102, path 0:0, Counterexample: [0] — green: node --test tests/schema-parity.test.mjs passed
tdd: schema preflight rejects crossed required array bounds — red: seed 2601102, path 0:0, Counterexample: [0] — green: node --test tests/schema-parity.test.mjs passed
tdd: schema preflight rejects required integer intervals containing no integer — red: seed 2601102, path 0:0, Counterexample: [0] — green: node --test tests/schema-parity.test.mjs passed
tdd: Codex schema repairs accumulate input and cached input usage across turns — red: actual inputTokens20/cachedInputTokens4, expected inputTokens30/cachedInputTokens6 — green: node --test tests/schema-parity.test.mjs passed
tdd: same-prefix siblings wait for first response rather than the first completed agent — red: AssertionError 2 !== 1 — green: node --test tests/prefix-warmup.test.mjs passed
tdd: a revised host prefix does not wait on its previous revision warming — red: AssertionError 1 !== 2 — green: node --test tests/prefix-warmup.test.mjs passed
tdd: Codex marks first model output before a streamed turn completes — red: AssertionError false !== true — green: node --test tests/codex-response.test.mjs passed
tdd: Codex tool requests count as model responses before their tools complete — red: AssertionError false !== true — green: node --test tests/codex-response.test.mjs passed
```

```text
tdd: Codex uses validated JSON text fallback for object intersections and repairs invalid output — red: TypeError: Codex structured output cannot preserve object schema composition with sibling constraints or allOf — green: node --test tests/schema-parity.test.mjs passed
tdd: Codex streamed provider failures retain their typed recovery metadata — red: The validation function is expected to return "true". Received false; caught Error: quota exhausted — green: node --test tests/codex-response.test.mjs passed
tdd: Codex closes persistent provider threads after success and provider failure — red: AssertionError 0 !== 1 — green: node --test tests/codex-response.test.mjs passed
tdd: app-server transport returns native agent text and usage — red: Error: Codex Exec exited with code 1: SyntaxError: Unexpected token 'h', "hello" is not valid JSON — green: node --test tests/codex-app-server.test.mjs passed
```

The app-server cycle is shared with the worker owning that module/test. Trusted `providers.codex.transport: 'app-server'` selects it; default remains exec and unknown transport names fail. Adapter errors preserve native typed recovery metadata. Persistent threads close after success and failure. See the native worker's evidence for protocol-specific tests and live validation.

Supporting boundary tests were green when introduced; red not observed: optional primitive union property, tagged local-reference union property, original oneOf overlap rejection, failed warming leader release, and distinct-model prefix concurrency. Latest targeted results: schema29/29, prefix4/4, Codex response6/6. The completed integration run before the later fallback/native expansion passed203/203 (10.620seconds); full integration is rerun after concurrent native recovery work. See shared delivery evidence for final totals.

Further observed cycles before final integration:

```text
tdd: Codex charges measured failed-turn usage after earlier schema repair usage — red: actual outputTokens2/inputTokens5/cachedInputTokens1, expected outputTokens5/inputTokens12/cachedInputTokens3 — green: node --test tests/codex-response.test.mjs passed
tdd: Codex uses original JSON semantics for unsupported native assertion keywords — red: AssertionError actual outputSchema object != expected undefined — green: node --test tests/schema-parity.test.mjs passed
tdd: Codex preserves object literal constraints without applying presence wrappers inside equality — red: seed 2601102, path 0:0, Counterexample: ["const",""] — green: node --test tests/schema-parity.test.mjs passed
tdd: Codex preserves unconstrained property schemas using JSON text — red: AssertionError actual outputSchema object != expected undefined — green: node --test tests/schema-parity.test.mjs passed
```

A second live default-model exec canary returned `{"answer":{"a":1,"b":2}}` for an object allOf schema through validated JSON text, outputTokens=15. Its isolated scratch directory was removed in finally.

Final supported-validator and default-exec classifier cycles:

```text
tdd: unsupported schema assertion dialects fail before provider startup instead of weakening validation — red: AssertionError: Missing expected rejection. — green: node --test tests/schema-parity.test.mjs passed
tdd: standard email formats are validated and repaired instead of ignored — red: TypeError: invalid JSON Schema: unknown format "email" ignored in schema at path "#/properties/email" — green: node --test tests/schema-parity.test.mjs passed
tdd: Codex exec failures classify exact API envelopes while retaining measured usage — red: The validation function is expected to return "true". Received false; caught exact model_not_found API envelope — green: node --test tests/codex-response.test.mjs passed
```

Unknown-format refusal and standard annotation acceptance are supporting tests, red not observed. Exact exec envelope classification reuses the native transport classifier, preserving usage and existing typed metadata; ambiguous prose errors remain unclassified.

Request isolation follows recovered `chunk-gmxe4kpt.js` functions `RSt`/`sn`: compile once per provider invocation with a fresh AJV registry; schema ids never become ambient authorities for later requests. The same source explicitly rejects `$async`, which is also rejected before provider startup here.

```text
tdd: independent schema requests can reuse an id with revised constraints — red: TypeError: invalid JSON Schema: schema with key or id "https://schema.example.test/revised-result" already exists — green: node --test tests/schema-parity.test.mjs passed
tdd: asynchronous schemas fail preflight before any provider can start — red: 'Error: provider must not start' (expected /invalid JSON Schema.*async/) — green: node --test tests/schema-parity.test.mjs passed
```

Ambient reference isolation is supporting boundary coverage, red not observed: a later schema cannot resolve a remote reference merely because a previous invocation used that id.
