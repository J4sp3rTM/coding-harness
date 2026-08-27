# @deepseek-ai/dsh-command-usage

Human-facing `/usage` projection over optional [`dsh-provider-status`](../provider-status/README.md) and `dsh-llm-deepseek`. It reports subscription plan windows, rate-limit counters, and account balance for the route the session last requested.

## Command contract

`/usage` returns one line of provider allowance. Session token counts and context pressure are omitted.

```text
plan 24% left (5h) · 88% left (7d) · resets in 1h 39m · $12.50 left
```

Trailing input is ignored. When no plan, quota, or balance fact exists the line is `no quota observed`.

Allowance segments appear only when their facts exist, and are scoped to the provider route of the session's latest logged request — the Agent's creation-time options are deliberately not consulted, because a session switched to another model in a composer keeps them and would otherwise report a foreign route's allowance. A session that has issued no request yet reports no allowance at all. Before reading, `/usage` asks `ctx.get('providerStatus')?.refresh(...)` so adapters that cannot publish headers on their ordinary transport (Codex WebSocket) or that keep subscription percent on a billing endpoint (SuperGrok) can harvest once. `ctx.get('providerStatus')` then supplies both segments: subscription plan windows render as `plan 94% left (5h) · 90% left (7d)` in provider order, and rate-limit counters as `quota 92% tokens left · 98% requests left`, each closing with `resets in …` for the earliest future reset the provider documents. When `ctx.get('deepseekAccount')` serves that route and resolves an amount, `$X.XX left` closes the line. Unavailable records, unserved routes, missing keys, and unmounted services all contribute nothing.

The command adds no usage sample and appends only `command/run` / `command/done`. A refresh may perform one provider probe (a quota HTTP GET or a billing GET) under the invocation's cancellation signal; a balance lookup performs one live GET against the DeepSeek endpoint.

## Composition

```yaml
- id: command-usage
  name: '@deepseek-ai/dsh-command-usage'
```

The composition must also provide `commands`. The provider-status store and the deepseek account capability are read optionally through `ctx.get`, so mounting neither keeps the command working unchanged.

## Model Experience

### Usage report

#### What the model sees

Nothing. The `/usage` report is rendered directly by the command adapter.

#### Token effect

No model-visible request is made. An on-demand refresh may issue one quota HTTP GET (Codex) or one billing GET (SuperGrok); neither result is appended to the session.

#### KV Cache effect

No effect because the model-visible surface is unchanged.

## Known Limitations and Deferred Work

- **Quota is last observation plus on-demand harvest** — `/usage` refreshes when a refresher is registered, then reads the store. A harvest failure leaves the previous record serving; there is no freshness cutoff.
- **Route follows the last request, not the pending selection** — a model switched in a composer changes the reported route only once a request has been logged under it, because a command cannot read a selection that has not reached a request yet.
