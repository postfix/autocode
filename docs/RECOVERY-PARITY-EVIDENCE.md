# Recovery implementation evidence

Recovered local source: `/home/john/rev/package/autocode/references/recovered-code/all/chunk-2pjf4p7s.js`.

- Lines 3506–3550: degraded response means not stalled/skipped, absent stop reason, absent structured result, fewer than 50 output tokens, duration greater than `min(stallMs / 2, 90000)`. Wait 45000ms and retry once; a second degraded response does not start another throttle backoff.
- Lines 3549–3590: five stall retries, distinguishing `replyLost` silent-response-stream failures from no-progress failures. Tokens from previous attempts accumulate.
- Lines 3403–3457: trusted quota coordinator joins native quota limits and retries after release; declined, revoked, and aborted waits have distinct outcomes.

Runtime now implements the missing degraded-response backoff and recognizes provider-reported stalled/lost-reply responses. The existing host quota hook remains the integration seam. No Codex stop reason is fabricated: its pinned native completed event exposes usage only. Missing measured duration cannot trigger degraded-response detection. Claude's adapter exposes native duration/stop reason in the companion change.

Confirmed public seam: `runWorkflow`. Tests use node:test virtual timers, without a production clock option.

```text
tdd: a slow low-token response without a stop reason waits 45 seconds and retries once — red: AssertionError [ERR_ASSERTION]: degraded response must wait before returning (true !== false) — green: node --test tests/throttled-recovery.test.mjs passed
tdd: a provider-reported lost reply retries and includes its spent tokens — red: TypeError: workflow values must be JSON-serializable — green: node --test tests/lost-reply-recovery.test.mjs passed
tdd: a throttle retry does not start the separate stalled-response retry loop — red: AssertionError [ERR_ASSERTION]: The input did not match the regular expression /stalled/. Input: '' — green: node --test tests/throttled-recovery.test.mjs passed
tdd: terminal and unmeasured responses do not enter throttle backoff — red not observed (boundary verification)
```

Connected recovery/replay/usage run: 26 tests passed, zero failures. Evidence log: `.scratch/replay-audit/recovery-tests.log`. This work does not establish complete provider transient classification or a standalone Codex quota-reset service. Native signals absent from the pinned SDK remain absent rather than inferred from ordinary text.

## Native watchdog default/config follow-up

The previously missing imported definition was located in the original unpacked shipped modules, without changing their bytes:

- `/home/john/rev/package/unpacked/claude-unpacked/chunk-x3dkgs4r.js`, `function Lfo`: explicit async-agent stall environment override; otherwise 600000ms if stream watchdog disabled; otherwise `min(Xfn() + 300000, 2147483647)`.
- `/home/john/rev/package/unpacked/claude-unpacked/chunk-bbw420pv.js`, `function Xfn` and `Np`: stream idle environment timeout with a 300000ms floor; private server-side configuration is the fallback when supplied by Claude's own host.

Corrected the runtime's previous 300000ms default to 600000ms. Added the native explicit stall timeout and stream idle timeout environment configuration, timer upper clamp, and disabled-stream-watchdog fallback. Explicit workflow/host stallMs retains precedence. Private Claude server configuration is unavailable to this standalone runtime; trusted hosts can supply stallMs.

```text
tdd: the default no-progress watchdog waits ten minutes before retrying — red: AssertionError [ERR_ASSERTION]: 2 !== 1 — green: node --test tests/watchdog-default.test.mjs passed
tdd: explicit async stall timeout environment overrides the computed default — red: AssertionError [ERR_ASSERTION]: 1 !== 2 — green: node --test tests/watchdog-default.test.mjs passed
tdd: stream idle timeout extends the watchdog by five minutes — red: AssertionError [ERR_ASSERTION]: 2 !== 1 — green: node --test tests/watchdog-default.test.mjs passed
tdd: disabled stream watchdog keeps the fixed ten-minute agent timeout — red: AssertionError [ERR_ASSERTION]: 1 !== 2 — green: node --test tests/watchdog-default.test.mjs passed
```

The virtual-time throttle tests now wait for the durable retry record before advancing the 45-second timer. This removes dependence on filesystem scheduling under concurrent full-suite execution. Combined watchdog/throttle validation passed 8/8 tests, preserving the companion structured-response bypass regression.
