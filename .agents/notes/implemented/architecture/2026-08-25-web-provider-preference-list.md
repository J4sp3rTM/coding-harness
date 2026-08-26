# Agent Note: Ordered provider preference list in the web seam

Status: implemented

English | [中文](2026-08-25-web-provider-preference-list.zh.md)

## Problem

The web seam selected one provider through a single pinned id (`searchProvider` / `$DSH_WEB_SEARCH_PROVIDER`) or order-independent auto-selection among usable providers. A pinned id that was registered but unavailable was a hard failure, so the shipped composition (`searchProvider: deepseek-official`, [web-default-search Agent Note](../feature/2026-07-31-web-default-search.md)) left every deployment without `DEEPSEEK_API_KEY` unable to search at all — even though a credential-free backend existed as a package (`dsh-web-search-exa` and friends all require keys; none filled the gap until [the keyless DuckDuckGo provider](../../../../packages/web/web-search-duckduckgo/README.md) landed alongside this decision).

Expressing "prefer DeepSeek, fall back to something keyless" needed either a silent auto-fallback around explicit pins or a new seam concept. Auto-fallback around pins was unacceptable: a pinned id is a deployment decision, and quietly routing around it (including around `$DSH_WEB_SEARCH_PROVIDER`, which an operator may set to force one route for diagnosis) would make the configured value a suggestion.

## Decision

`WebRuntimeConfig` gains an ordered preference list per capability: `searchProviders` and its symmetric twin `fetchProviders`. Resolution happens at execution time with one clear precedence rule — **explicit over implicit**: the single pin wins outright while set (and still hard-fails on unavailable, never falling back); the list applies when no pin is set; order-independent auto-selection applies when neither is present.

Walking the list:

- The first listed id that is registered AND `available()` wins.
- A listed id that is registered but unavailable is SKIPPED — that skipping is the feature, and it stays silent because availability loss (a rotated-away key, an unset credential) is an expected operating state, not a fault.
- A listed id that is NEVER registered fails with `WEB_PROVIDER_CONFIGURED_MISSING`. Presence of every listed id is validated before the availability walk, so a typo fails loudly regardless of which entries happen to be usable today.
- An exhausted list (all present, none available) fails with `WEB_PROVIDER_UNAVAILABLE`.

An explicitly empty list behaves like an omitted one (no preference): schemastery resolves an omitted array field to `[]`, so "empty" and "absent" are indistinguishable at construction and a loud empty-list rejection cannot be expressed there.

The shipped [`dsh-base`](../../../../packages/bundle/base/cordis.patch.yml) composition mounts the new keyless provider and sets `searchProviders: ['deepseek-official', 'duckduckgo']`, replacing the pinned id. `fetchProviders` mirrors the mechanism for symmetry even though one fetch provider ships today, so the two parallel registries keep one vocabulary.

The private-network scope that made this pairing safe for `web_fetch` is owned separately by [the fetch guard Agent Note](2026-08-25-web-fetch-private-network-guard.md).

### Testing shape

Seam unit tests pin each rule: order-dependence (reversed lists pick differently), skip-unavailable, position-independent `WEB_PROVIDER_CONFIGURED_MISSING`, exhausted-list failure, pin-dominance over an ignored list, env-var-as-pin dominance, empty-list-as-no-preference, and the mirrored fetch behavior.

## Alternatives considered

**Auto-select when the pinned provider is unavailable.** Rejected: it converts an explicit deployment decision into a suggestion, makes `$DSH_WEB_SEARCH_PROVIDER` diagnostics unreliable, and hides credential loss behind a different backend's results.

**Fail-over inside `dsh-tool-web` or callers.** Rejected: provider selection is seam-owned by design ([web capability seam Agent Note](2026-06-24-web-capability-seam.md)); teaching each consumer to catch `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` and re-call would duplicate policy and let consumers diverge.

**Treat runtime search failures as fallback triggers.** Rejected: unavailability (checked locally before dispatch) and runtime failure (after a request left) are different facts; re-dispatching a query onto another provider after a partial failure doubles cost and side effects and turns transient errors into silent route changes.

**Skip missing ids too.** Rejected: a misspelled id would drop out of the chain invisibly; the repo rule is that a missing referent fails loud.

## Consequences

A deployment without any DeepSeek key searches through DuckDuckGo out of the box, and one with a key keeps the native-search route while gaining an automatic fallback if the key disappears. The cost is that markup-scraping fragility ([provider README Known Limitations](../../../../packages/web/web-search-duckduckgo/README.md#known-limitations-and-deferred-work)) becomes part of the default experience, and the shipped tool-roster assertions that pinned `fetch: false` and the single search id had to move with this change.
