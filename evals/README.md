# Autocode skill evals

`npm test` checks the workflow runtime, provider adapters through SDK fakes, package contents, and bundled templates. It also checks that skeptical verification rejects a false finding and that exhaustive review deduplicates findings, votes, and stops after dry rounds.

Run the live eval from a machine with Codex subscription authentication and the Autocode skill installed at `~/.codex/skills/autocode`:

```bash
node evals/live-skill.mjs
```

The eval writes its project and run journal under the workspace's `.scratch/autocode-evals` directory, keeping heavy scratch work off RAM-backed `/tmp`. Set `AUTOCODE_EVAL_SCRATCH` to another disk-backed directory if needed. A sandboxed Codex SDK thread invokes `$autocode` to author a workflow; then the harness runs that exact script through the Autocode CLI with three read-only Codex SDK agents. It checks the authored script, journal, result, and unchanged source file. The report prints the project path for inspection. No API key is required.

This tests skill authoring and execution as separate stages. An integrated attempt to run the nested Codex SDK from inside the sandboxed host failed to initialize its Codex state, even with a dedicated writable state directory. That environment limitation remains a failing end-to-end case; the harness must not be reported as proof that default sandboxed invocation works. The eval also does not cover live Claude calls, model switching, or every template.
