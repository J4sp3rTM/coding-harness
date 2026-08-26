# @deepseek-ai/dsh-command-usage

Human-facing `/usage` projection over [`ctx.tokenMeter`](../token-meter/README.md). It reports the latest provider usage anchor when available and the session's current request pressure; when the composition also mounts [`dsh-provider-status`](../provider-status/README.md) and `dsh-llm-deepseek`, it leads with what those services know about the route the session last requested.

## Command contract

`/usage` returns one line: provider allowance first, then the session's own figures after an em dash.

```text
plan 24% left (5h) · 88% left (7d) · resets in 1h 39m — 7755 in / 701 out · 82696 ctx · $12.50 left
```

A provider-backed baseline renders `<in> in / <out> out`; an estimated or empty baseline renders `no provider call yet (estimated)` or `no provider call yet`. Current context pressure always follows as `<n> ctx`. Trailing input is ignored.

Allowance segments appear only when their facts exist, and are scoped to the provider route of the session's latest logged request — the Agent's creation-time options are deliberately not consulted, because a session switched to another model in a composer keeps them and would otherwise report a foreign route's allowance. A session that has issued no request yet reports no allowance at all. `ctx.get('providerStatus')` supplies both segments: subscription plan windows render as `plan 94% left (5h) · 90% left (7d)` in provider order, and rate-limit counters as `quota 92% tokens left · 98% requests left`, each closing with `resets in …` for the earliest future reset the provider documents. When `ctx.get('deepseekAccount')` serves that route and resolves an amount, `$X.XX left` closes the trailing figures. Unavailable records, unserved routes, missing keys, and unmounted services all contribute nothing.

The measurement replays the durable session tail through the token meter. The command adds no usage sample and appends only `command/run` / `command/done`; a balance lookup performs one live GET against the provider endpoint with the invocation's cancellation signal.

## Composition

```yaml
- id: command-usage
  name: '@deepseek-ai/dsh-command-usage'
```

The composition must also provide `commands` and `tokenMeter`. The provider-status store and the deepseek account capability are read optionally through `ctx.get`, so mounting neither keeps the command working unchanged.

## Model Experience

### Usage report

#### What the model sees

Nothing. The `/usage` report is rendered directly by the command adapter.

#### Token effect

No model request is made. Reading the token meter does not change later request pricing.

#### KV Cache effect

No effect because the model-visible surface is unchanged.

## Known Limitations and Deferred Work

- **Latest call, not billing ledger** — provider usage is the latest reusable measurement anchor, not an account-wide or cumulative cost report.
- **Estimated fallback** — providers that do not report usage yield heuristic context pressure.
- **Quota is last observation, balance is live-on-ask** — the quota percentages come from the most recent response that carried rate-limit headers and may be stale; there is no freshness cutoff. The balance figure is fetched fresh per invocation for the one route whose adapter publishes the capability.
- **Route follows the last request, not the pending selection** — a model switched in a composer changes the reported route only once a request has been logged under it, because a command cannot read a selection that has not reached a request yet.
