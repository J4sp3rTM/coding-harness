# Agent Note: Provider quota and balance reporting in /usage

Status: implemented

English | [中文](2026-08-25-provider-quota-and-balance-in-usage.zh.md)

## Problem

`/usage` could only report what the session log already priced: the latest call's token counts and current context pressure. A user about to burn through a rate-limit window or a prepaid balance had no in-session way to see either figure, and nothing in the harness even captured them — provider responses disclose quota on the wire, but every adapter dropped those headers on the floor.

## Decision

[`dsh-provider-status`](../../../../packages/llm/provider-status/README.md) is an ephemeral host-process store of the last status observation per provider route (`ctx.providerStatus`). [`dsh-llm-pi-ai`](../../../../packages/llm/llm-pi-ai/README.md) threads pi-ai's `onResponse` callback through its stream call and publishes two separate measurement axes from allowlisted headers: API-key routes yield limit/remaining counter dimensions from OpenAI `x-ratelimit-*` and Anthropic `anthropic-ratelimit-<axis>-*` fields, while subscription routes yield plan windows from Anthropic's `anthropic-ratelimit-unified-*` utilization fractions and Codex's `x-codex-*` used-percent fields, each carrying the provider's own window label and reset. Unparseable values record an explicit unavailable state, and unrecognized headers go nowhere. [`dsh-llm-deepseek`](../../../../packages/llm/llm-deepseek/README.md) publishes an optional `deepseekAccount` capability that answers one live GET `{base}/user/balance` per ask with redirect refusal (`redirect: 'error'` plus an explicit 3xx check). [`dsh-command-usage`](../../../../packages/llm/command-usage/README.md) renders `/usage` as one line of provider allowance: plan windows and counter dimensions as whole-percent-remaining segments, plus account balance when a provider exposes one. Session token counts and context pressure are omitted; the harvest and render contract is owned by [on-demand `/usage` harvest](2026-08-26-on-demand-usage-harvest.md). Those segments are scoped to the provider of the session's latest logged request header rather than the Agent's creation-time options, because a session switched to another model in a composer keeps those options and would otherwise report a foreign route's allowance.

Three boundaries hold the design together:

- **Counters and plan windows are different measurements.** A counter dimension reports a rate-limit window's absolute allowance; a plan window reports how much of a subscription allowance period is consumed. They are stored and rendered separately and are never mixed or summed. A snapshot's `remaining` is the provider's window allowance for the credential that received that response — not consumed amount, not billing, and never valid across a credential rotation without fresh observation. Records carry a non-secret `credentialIdentity` label so diagnostics can tell configurations apart; no key material ever enters the store.
- **Ephemeral host state.** The service keeps one latest record per route in memory: disposal drops it, another process never sees it, and no freshness cutoff exists because any cutoff would be an invented tunable. Consumers decide how to present age from `observedAt` and reset timestamps.
- **Optional by `ctx.get`.** Neither consumer declares the services as injections. Compositions that mount neither report `no quota observed`. The shipped base bundle mounts `dsh-provider-status` so `/usage` can report last-observed quota; a custom composition that omits the row still works unchanged.

## Alternatives considered

**Persist snapshots or fold them into the session log.** Rejected: quota figures are advisory, per-credential observations that would put model-visible-adjacent data into durable storage for no reconstructability benefit, and staleness policy would leak into whatever read the persisted rows.

**Put balance behind a generic LlmAdapter method exposed by dsh-llm.** Rejected at this stage: it would grow the shared seam for exactly one provider's documented endpoint, and the seam's registry deliberately exposes metadata rather than adapter instances. A second balance-capable provider is the trigger to lift the capability into the seam.

**Fetch quota live inside the command handler.** Rejected as the default for HTTP transports: quota arrives free on responses the session already makes. Routes whose ordinary transport cannot publish headers, or whose subscription percent lives on a separate billing endpoint, harvest once from `/usage` — [on-demand `/usage` harvest](2026-08-26-on-demand-usage-harvest.md).

## Consequences

The shipped base reports quota percentages and reset countdowns for routes whose providers publish rate-limit headers, subscription plan remaining for Anthropic OAuth, Codex OAuth, and SuperGrok billing, plus DeepSeek's remaining USD balance, without leaving the session. A composition that omits the store or the DeepSeek adapter sees no change at all. Codex plan windows are not on the WebSocket transport; `/usage` reads them from the Codex OAuth usage endpoint without starting inference. The cost is a third small llm-group package, optional reads plus one optional harvest inside the command handler, and the standing obligation to keep the normalizer allowlist closed — a new provider's headers stay invisible until someone documents and allows them.
