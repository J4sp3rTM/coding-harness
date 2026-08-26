# @deepseek-ai/dsh-provider-status

English | [中文](README.zh.md)

Ephemeral host-process store of the last observed provider status per route (`ctx.providerStatus`). Adapter-side observers publish quota snapshots parsed from a provider response's rate-limit headers, or an explicit unavailable state; read-only consumers such as [`/usage`](../command-usage/README.md) look the latest record up by provider route.

## Service contract

`ctx.providerStatus` is provided by the `@deepseek-ai/dsh-provider-status` plugin and owns one latest record per route; every publication replaces the previous one, and disposal of the owning fiber drops all state. Records are frozen detached copies:

```yaml
- id: provider-status
  name: '@deepseek-ai/dsh-provider-status'
```

The plugin takes no configuration. Consumers that treat the service as optional read it through `ctx.get('providerStatus')`, so compositions without it keep working unchanged.

- `recordSnapshot({ routeId, credentialIdentity?, dimensions?, windows? })` commits a snapshot with at least one quota measurement. A dimension (`requests`, `tokens`, `inputTokens`, `outputTokens`) reports a rate-limit counter with a positive finite `limit`, finite non-negative `remaining`, and optional epoch-millisecond `reset`. A plan window reports subscription allowance consumption with a non-empty label, `usedPercent` from 0 through 100, and optional epoch-millisecond `reset`. These are different measurements and must not be mixed or summed. Every value is validated at this publish point; a rejected publication leaves the previous record serving.
- `recordUnavailable({ routeId, credentialIdentity?, reason })` commits an explicit unavailable state, for responses whose recognized status fields were all unusable. A response with no recognizable fields is simply not published.
- `lookup(routeId)` answers `{ kind: 'snapshot', ... }` or `{ kind: 'unavailable', ... }`, stamped with the commit time as `observedAt`. Snapshot records always contain `dimensions` and `windows` arrays, either or both of which may be empty.

`credentialIdentity` is a non-secret label such as the credential reference name; key material never enters a record. A dimension's absence is distinct from a zero value: nothing invents a `0` where a provider reported nothing. A plan window's `usedPercent` measures subscription consumption, not rate-limit remaining capacity.

## Model Experience

### Provider status report

#### What the model sees

Nothing. The store feeds human-facing projections only; no prompt section, tool schema, or request field reads from it.

#### Token effect

No model request is made or altered. Publishing to and reading from `ctx.providerStatus` performs no provider call of its own; a quota snapshot describes a response that already happened.

#### KV Cache effect

No effect because the model-visible surface is unchanged.

## Known Limitations and Deferred Work

- **Last observation, not a ledger** — the store keeps one advisory record per route in host memory: no history, no cross-process visibility, and no account-wide usage or billing figure. Rate-limit `remaining` is the provider's own window allowance, not consumed amount.
- **No staleness policy** — records carry `observedAt` but the store applies no freshness cutoff, so a consumer rendering a stale record must decide how to present its age.
- **Response-header source only** — no polling endpoint and no subscription-based quota source exists; providers that never send rate-limit headers stay permanently unobserved.
