# Agent Note: Fork CI skips the static, coverage, and consumer gates

Status: proposed

English | [中文](2026-08-25-fork-ci-skips-static-and-coverage-gates.zh.md)

## Problem

Outside `deepseek-ai/deepseek-harness`, a pull request reports `all checks passed` without running lint, hygiene, the `doc-sync` leaves, coverage, or the built-consumer tail.

Three jobs in [ci.yml](../../../../.github/workflows/ci.yml) carry those gates: `node-24` runs `check:ci:static`, `node-24-coverage` runs `check:ci:coverage`, and `node-24-consumers` runs `check:ci:consumers`. Each requests a larger-runner label (`dsh-ubuntu-24-04-16core`) that only the upstream organization provides, so each is guarded by `github.repository == 'deepseek-ai/deepseek-harness'`. The `all-checks-passed` aggregator then exempts exactly those three from its skip check outside that repository. The guard is correct — the labels do not resolve elsewhere, and an unguarded job would queue forever — but the verdict it produces is indistinguishable from a real pass.

The [portable pull-request CI boundary](../../implemented/process/2026-07-23-portable-required-pull-request-ci.md) already rejected demoting checks when capacity is unavailable, on the ground that doing so makes the status green by dropping evidence rather than by running the repository's required contracts. That note governs the upstream topology, where every skip is fatal. This proposal extends the same principle to the one place the aggregator still exempts, and does not change the upstream pools it owns.

The gap is not theoretical. A checkpoint commit deleted 2090 Agent Note files and 21 skill files while `AGENTS.md`, `packages/AGENTS.md`, and fourteen source files kept citing them. `verify-md-links` and `verify-doc-refs` own that failure and sit in `ci-static`, so the deletion produced 674 unresolvable links and a green branch for six days, until the gates were run by hand.

A second instance affects local runs: `run-gates` spawns each gate as `node $npm_execpath`, which requires the pnpm JavaScript entrypoint. Where pnpm is installed as the `@pnpm/exe` standalone binary, Node parses that binary as an ES module and every gate fails within two seconds with `SyntaxError: Invalid or unexpected token`. The failure is uniform across all 28 gates, so it reads as repository-wide drift rather than a launcher defect.

## Proposal

Resolve the runner label instead of the repository, so the guard stops deciding whether the gate runs at all:

- Replace each `if` with `github.event_name == 'pull_request'`, and extend each `runs-on` expression with a final `|| 'ubuntu-latest'` arm selected when `github.repository` is not the upstream one.
- Delete the three-job exemption in the `all-checks-passed` skip condition, making every skip fatal everywhere.
- Resolve `DSH_GATE_CONCURRENCY` from the selected runner rather than the fixed `'8'`, which is tuned for sixteen cores. The [larger-runner decision](../../implemented/process/2026-07-22-evidence-based-larger-hosted-runners.md) owns host-specific worker bounds and requires measurement rather than an advertised core count.

Sequence this after the documentation gates are green on the target repository. Enabling `ci-static` against unresolved link drift turns every pull request red on the first run.

For `run-gates`, detect a non-JavaScript `npm_execpath` and spawn it directly instead of through `process.execPath`. The current form exists so Windows never spawns the `pnpm.cmd` shim through a shell; a binary entrypoint is spawnable without a shell on every platform, so the Windows constraint survives.

## Alternatives considered

**Leave the guard and rely on local checks.** Rejected: the repository requires evidence matched to the changed surface, and the deletion above shows that a gate nobody runs is a gate nobody runs. It also leaves `all checks passed` reporting a verdict it did not compute.

**Add a separate reduced fork-only job.** Rejected: it duplicates the gate list, and the copy drifts from `run-gates` the first time a leaf is added. The existing jobs already name their suites through one script.

**Enable only `ci-static`.** Deferred rather than rejected. It buys lint, hygiene, and documentation for the smallest runtime cost, and coverage is the expensive job on a two-core runner. Worth taking as a first increment if the full set proves too slow.

## Acceptance criteria

A pull request on a fork reports real results for the static, coverage, and consumer jobs; `all checks passed` fails when any of them fails or is skipped. `pnpm run doc-sync` completes on a host where pnpm is the standalone binary.

## Risks

Coverage runs the whole suite on a standard hosted runner and may exceed the job time limit; the concurrency default is sized for the larger runner and needs measurement, not assumption. Enabling the gates surfaces whatever drift the fork already carries, which is the point but arrives as a burst of red. The upstream repository's behavior must not change: its jobs keep the larger-runner labels and its skips stay fatal.
