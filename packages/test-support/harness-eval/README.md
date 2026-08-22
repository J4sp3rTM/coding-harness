# `@deepseek-ai/dsh-harness-eval`

English | [中文](README.zh.md)

Private support infrastructure for deterministic A/B evaluations. It owns the seed/oracle fixture catalog, managed process execution, completion-based validation classifier, real Codex and DeepSeek Harness adapters, versioned comparison artifacts, and CLI. The default mode only copies fixtures and runs their validation command without calling a model.

## Keyless evaluation

Run the source CLI with `node --import tsx/esm packages/test-support/harness-eval/src/cli.ts --out <dir>`. Add `--oracle` to overlay passing sources before validation, `--repetitions N` to repeat the A/B matrix, or `--concurrency N` to execute isolated runs in parallel. Concurrency defaults to one so latency measurements remain directly comparable. `--suite baseline` is the four-task smoke suite and remains the default; `medium`, `difficult`, and `stress` each select three progressively harder tasks, while `all` selects all thirteen. The CLI writes run, workspace, agent, validation, and completion progress to stderr while keeping its final JSON summary on stdout. A comparison is written to `comparison.json`, with validation stdout and stderr retained as separate evidence files.

Validation status is derived from confirmed process completion. A zero exit code is required for `passed`; timeout, cancellation, missing status, and terminating signals are classified separately. Output text, including a `PASS` line, never changes the status.

The artifact has `schemaVersion: 1`. Usage and cost are normalized nullable fields: absent provider metadata is represented by `null`, never by a fabricated estimate. Product outcome, process completion, and fixture validation are independent fields, so controlled app-server teardown cannot replace a completed model outcome. Observable executor timing is split into startup, agent, and teardown segments. `runAbEval` accepts an executor callback that receives the copied workspace and variant and may return separately classified executor-process evidence plus provider metadata. Fixture validation always runs independently after a non-skipped executor. An executor may return a skip reason; the run is retained as `inconclusive` and the comparison continues. It does not infer a live run from an API key.

## Codex versus DeepSeek Harness

Run `node --import tsx/esm packages/test-support/harness-eval/src/cli.ts --out <dir> --live` for the real comparison. Variant A runs the official Codex app-server through an isolated `CODEX_HOME`, an OpenRouter Responses provider, and `danger-full-access` confined by the disposable fixture workspace. Variant B runs the DeepSeek Harness source CLI with the shipped `code` preset mounted through its preset service. Both variants use `stealth/ox-alpha` with reasoning effort `high` and receive the same copied fixture without repository instruction files.

Codex requires an explicit `OPENROUTER_API_KEY`. Its isolated configuration disables plugins, plugin recommendations, the remote plugin catalog, update checks, and shell snapshots so unrelated first-run setup does not enter agent timing. On Windows, the adapter prefers the executable bundled under the Codex Desktop local application-data directory and otherwise uses the ordinary PATH launcher. DeepSeek Harness reads the existing OpenRouter subscription from the selected Harness OAuth document, but uses a temporary `DSH_HOME` for evaluation sessions and settings. Credentials are passed only at process boundaries and are not written to result artifacts. A missing credential records that side as skipped; it never becomes a passing result. Each completed model run is followed by the fixture's independent validation command, whose confirmed exit facts determine correctness.

## Model Experience

None, as the evaluator submits only the fixture's ordinary user task and delegates system instructions and tool composition to the selected Codex or DeepSeek Harness runtime.

#### KV Cache effect

None across runs. Every fixture variant starts in an isolated process and copied workspace, so the evaluator does not retain a model-request prefix or conversation state between samples.

## Known Limitations and Deferred Work

The catalog contains four baseline fixtures plus three medium, three difficult, and three stress fixtures. The stress group covers asynchronous lifecycle rollback, durable crash recovery, and tenant-isolated tool execution. It does not generate tasks or use a model judge. Usage and cost remain `null` when an adapter does not expose authoritative measurements, and a complete A/B result requires both an OpenRouter API key for Codex and an OpenRouter OAuth subscription for DeepSeek Harness.
