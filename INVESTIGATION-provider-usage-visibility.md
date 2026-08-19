# Investigation: provider usage and remaining quota

## Scope

This investigation traces the existing model/provider path and evaluates whether the web GUI can show remaining usage for the currently relevant `llm-pi-ai` routes, especially OpenAI and Anthropic. No provider credentials or live model requests were used.

## Finding

A provider-neutral cumulative “usage percentage” is not available from the current model-listing flow. The application currently discovers model metadata, while quota information is a separate provider concern.

OpenAI and Anthropic expose useful per-response rate-limit headers. Those headers can support a trustworthy **remaining rate-limit** indicator after a normal model request, but they do not represent monthly spend, account credit, or a universal provider quota. Provider account usage and cost APIs are separate administrative APIs and require different privileges.

The recommended first increment is therefore a host-collected, last-observed rate-limit snapshot for OpenAI and Anthropic API-key routes. It should be displayed on the existing Models provider cards, labeled as rate-limit remaining rather than generic usage.

## Current model/provider flow

1. `packages/llm/llm-pi-ai/src/catalog.ts` reads pi-ai’s built-in provider and model catalog. Catalog providers such as `openai` and `anthropic` get their model metadata locally.
2. `packages/llm/llm-pi-ai/src/discovery.ts` returns catalog models without a network call when the route is known to pi-ai. Only an unknown/gateway route using an OpenAI-compatible protocol is probed with `GET {baseURL}/models`.
3. `packages/llm/llm-pi-ai/src/index.ts` registers the configurable-provider directory and the `llm-pi-ai` model-discovery handler. Discovery returns candidate model metadata only; it does not persist or return provider account state.
4. `packages/llm/llm-pi-ai/src/adapter.ts` builds the pi-ai `Models` collection and dispatches requests through `streamSimple()` at lines 408–459. The current adapter forwards profile headers and authentication, but does not install pi-ai’s `onResponse` callback.
5. `packages/host/apiproxy/src/api-proxy.ts` exposes `llm.providers`, `llm.models`, and `llm.discoverModels`. `llm.providers` joins configurable-provider directory entries with active route state; `llm.models` builds the host-wide model catalog.
6. `packages/client/ui-settings-models/src/client/store.ts` loads the provider directory, settings namespaces, and redacted credential state into one Models-page snapshot.
7. `packages/client/ui-settings-models/src/client/ModelsSection.tsx` renders each provider card. The existing row header has the provider identity, credential dot, and Edit/Delete actions at lines 314–390; this is the appropriate provider-level location for a compact status summary.

The direct `llm-deepseek` adapter has a separate static catalog and chat-completions transport, but it is out of scope for this pass because no live DeepSeek connection is available. If it is revisited later, its documented balance endpoint reports monetary balance rather than a percentage of a token or period quota.

The route keys `deepseek` and `deepseek-official` are distinct: the former is a generic pi-ai catalog route, while the latter belongs to the direct DeepSeek adapter. Existing usage support is limited to per-call `TokenUsage`, token-meter projections, and normalized quota-exhaustion errors; there is no provider account-status service. The existing `llm/adapters-updated` event reports topology changes only and is not a quota update channel.

## What the providers can report

| Provider route | Model discovery | Useful live signal | Account usage percentage from an ordinary model key | Assessment |
|---|---|---|---|---|
| OpenAI API key | Built-in pi-ai catalog for `openai`; no `/models` request is needed for the catalog route | `x-ratelimit-limit-*`, `x-ratelimit-remaining-*`, and `x-ratelimit-reset-*` response headers for request/token windows | No. Organization usage and cost endpoints are administrative and are not a normal project-key quota view | Good first target for last-observed request/token remaining |
| Anthropic API key | Built-in pi-ai catalog for `anthropic`; no `/models` request is needed for the catalog route | `anthropic-ratelimit-*-limit`, `*-remaining`, and `*-reset` headers, including request/token dimensions and, where supplied, input/output token dimensions | No. Usage and cost reporting is an Admin API concern, not a normal API-key response | Good first target for last-observed request/token remaining |
| OpenAI-compatible gateway/custom route | `GET /models` only for a route the catalog does not describe | Gateway-dependent; it may copy OpenAI headers or expose none | No generic answer | Parse only explicitly recognized headers; otherwise show unavailable |
| Anthropic subscription/OAuth route | Catalog metadata is local | Response headers may describe the active service, but they must not be presented as API-credit or subscription-plan usage without provider confirmation | No generic answer | Keep separate from API-key status until a provider-specific contract exists |
| Other pi-ai providers | Usually local catalog or provider-specific discovery | No shared quota header contract | No generic answer | Add provider adapters only when a documented signal exists |

“Remaining percentage” should be derived separately for each dimension as `remaining / limit * 100`. OpenAI request and token windows are different resources; Anthropic may also expose input and output token windows. Collapsing them into one number would hide the dimension that is actually close to exhaustion. The response-body usage fields should remain separate: they report consumption for the current request, not remaining quota.

## Recommended UI

Put a compact status line directly below the provider name and credential indicator in each Models provider card. Do not put this in the model picker: the signal belongs to the provider route and may apply to several models.

Suggested collapsed presentation:

```text
OpenAI   [key configured]                         Edit
Rate limits: 92% tokens remaining · 98% requests remaining
Updated after the last request · resets in 2m
```

The details popover or accessible tooltip can list each observed dimension, its raw remaining/limit values, reset value, source, and observation time. Use “Rate limits” or “remaining” in product copy; reserve “usage” for actual cumulative usage returned by a provider account API. A provider with no recognized snapshot should show no percentage rather than an invented zero, stale default, or failed setup state.

The existing provider row is preferable to the page header because it keeps the status beside the credential and route it describes, works for multiple configured providers, and does not imply that all models share one global account. The status should remain secondary to the Edit action and should not replace the existing credential dot.

`ModelsSettingsStore` is the correct UI owner: its `ProviderRow` already joins provider identity, settings state, and credential state. Add quota as an optional enrichment after the base provider/settings join, using the existing degraded-enrichment pattern so an unavailable quota endpoint never hides or disables a usable provider. Add loading, unavailable, stale, remaining, reset, and updated-time strings to the Models locales. No composer, model-directory, or settings-shell change is needed, and quota must not be stored in `settings.yaml`.

## Recommended data design

Add a provider-neutral, optional status record rather than adding a single `usagePercent` field. A suitable record would contain:

- route/provider id;
- observed dimensions such as `requests`, `tokens`, `inputTokens`, or `outputTokens`;
- `limit`, `remaining`, and provider-supplied reset value for each dimension;
- `observedAt` and a source tag such as `response-headers`;
- an optional provider error or `unavailable` state without exposing credentials.

Store this as host-process ephemeral state keyed by provider route and credential/configuration identity. It is not session-log data, is not model-visible, and should not be persisted as durable settings. Capture only an allowlisted set of rate-limit headers; never forward arbitrary response headers to the browser.

The pi-ai dependency already has the needed transport hook: `StreamOptions.onResponse` receives `{ status, headers }`, and both the OpenAI Responses and Anthropic Messages implementations invoke it after receiving the HTTP response. `PiAiAdapter.stream()` currently does not pass this callback, so the smallest transport change is to add a callback there, normalize OpenAI/Anthropic headers, and publish the snapshot to a host-owned provider-status capability.

Expose the latest snapshot through a host RPC used by the Models page. Two reasonable wire choices are:

- add optional `status` data to `ConfigurableProviderView`, minimizing the Models-page load changes; or
- add `llm.providerStatus`, keeping provider topology and volatile status as separate API methods.

The second choice is cleaner if status later gains explicit refresh, provider-specific account data, or multiple status sources. The page store can load provider rows and status in parallel and merge them by route id.

Because status changes after model calls, a push event should be debounced or the loaded Models page should refresh on an explicit interval/manual action. Follow the page lifecycle in `packages/client/ui-settings-models/src/client/index.ts`; do not start polling from render or emit a topology refresh for every response. A 30–60 second visible-page refresh, plus a manual refresh affordance, is sufficient for rate-limit status and avoids request storms. The first page load may legitimately have no status until a request has been observed.

## Security and correctness constraints

- Keep all status collection in the host. The browser must continue receiving redacted credential descriptors, never API keys.
- Do not call a provider’s account or admin usage endpoint with the model API key unless its documentation explicitly authorizes that key and the endpoint is provider-owned by the adapter.
- Do not make a hidden model request solely to populate the Models page; it can incur cost and alter the quota being displayed.
- Treat `limit`, `remaining`, and reset fields as provider data. Validate finite non-negative numbers, clamp only for presentation, and preserve an unknown dimension instead of converting it to zero.
- Key status by configured route, not only by provider family, because two custom routes can use different accounts or gateways.
- Keep rate-limit remaining, account balance, cumulative spend, and subscription-plan allowance as distinct status kinds. They are not interchangeable.
- If a response is served by a proxy, label the snapshot as observed from that route. The harness cannot infer the upstream account’s actual quota from model metadata.

## Provider references

- OpenAI rate limits: <https://platform.openai.com/docs/guides/rate-limits>
- OpenAI usage API: <https://platform.openai.com/docs/api-reference/usage>
- OpenAI organization costs: <https://platform.openai.com/docs/api-reference/usage/costs>
- Anthropic rate limits: <https://docs.anthropic.com/en/api/rate-limits>
- Anthropic usage and cost API: <https://docs.anthropic.com/en/api/usage-cost-api>
- Anthropic Admin API: <https://docs.anthropic.com/en/api/admin-api>

## Proposed follow-up slices

1. Add the provider-neutral status type and host-owned ephemeral store, with unit tests for OpenAI and Anthropic header normalization and reset parsing.
2. Pass pi-ai `onResponse` through `PiAiAdapter` and publish only the allowlisted headers for OpenAI/Anthropic API-key routes.
3. Add the host RPC/schema/client types and a debounced invalidation or visible-page refresh strategy.
4. Extend `ModelsSettingsStore` and the provider row with the compact status line, details view, loading/empty/stale states, and localized copy.
5. Add focused adapter, host API, UI, and assembled web snapshot coverage. Verify that routes without recognized provider status remain fully usable.

## Decision

It is feasible to show useful remaining percentages for OpenAI and Anthropic, but only as **last-observed rate-limit remaining**, not as a universal provider usage percentage. Implement that provider-status foundation first; defer provider account billing/usage endpoints until each provider’s authentication and privacy contract is explicitly designed.
