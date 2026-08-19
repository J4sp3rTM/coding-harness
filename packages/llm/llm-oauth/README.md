# dsh-llm-oauth

English | [中文](README.zh.md)

Subscription sign-in Service Definition (`ctx.llmOAuth`). A provider subscription — Claude Pro/Max, ChatGPT Plus/Pro, and the others the installed provider catalog ships — authenticates with a rotating OAuth token set rather than an API key, which is why it cannot travel through the [credential-reference seam](../../credentials/credentials/README.md): there is no stable value for configuration to name, the token rotates behind the harness's back, and obtaining one at all needs a browser round trip.

Three rules bind every provider of this seam:

**Tokens never leave the host.** Status surfaces read `LlmOAuthAccount`, which carries no secret — a route key, a display name, whether it is signed in, and when the stored access token expires. Only an LLM adapter reaches `tokens()`, and only to hand the store to the provider SDK that rotates it.

**Sign-in is interactive and cancellable.** A flow reports its steps and asks its questions through the caller's `LlmOAuthInteraction`, so one implementation serves a terminal, a slash command, and a browser page without any of them owning a sign-in screen.

**A stored token set owns its route.** While one is stored, the adapter authenticates that route with the subscription and never falls back to an ambient API key — a silent fallback would bill an unrelated account for a request the user meant to put on their plan.

## Surface

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { LlmOAuthInteraction } from '@deepseek-ai/dsh-llm-oauth'

declare const ctx: Context
declare const surface: LlmOAuthInteraction

ctx.llmOAuth.providers()                       // [{ provider, displayName, loginLabel }]
await ctx.llmOAuth.accounts()                  // the same, plus signedIn / expiresAt
await ctx.llmOAuth.status('anthropic')         // one route's account facts
await ctx.llmOAuth.login('anthropic', surface) // runs the flow, stores the token set
await ctx.llmOAuth.logout('anthropic')         // removes it from this machine
ctx.llmOAuth.tokens()                          // the store, for the LLM adapter alone
```

A `surface` implements `notify(event)` and `prompt(question)`. Events describe what is happening — an `auth-url` to open, a `device-code` to type, a `progress` line, an `info` note — and never carry a value the flow needs back. Every input the flow actually needs arrives through a prompt: `text`, `secret`, `select`, or `manual-code`, the paste-the-redirect fallback a flow races against its own loopback callback. A prompt carrying a `signal` is abandoned when that race resolves the other way, so a surface MUST settle such a prompt instead of leaving it pending.

`llm-oauth/updated (provider)` fires after a committed change to a stored token set — a completed sign-in, a sign-out, or a rotation. Consumers do not need the event (the adapter reads the store per request); it exists for status surfaces refreshing a "signed in" badge. Its declaration lives in the client-safe `./types` subpath export together with the account and interaction types it names, so a consumer outside the Host compilation face reads the very signature the Host emits.

`LlmOAuthError` codes: `UNKNOWN_PROVIDER` for a route the implementation does not offer, `LOGIN_ABORTED` when the human cancelled, `LOGIN_FAILED` when the flow itself failed.

## The token store

`LlmOAuthTokenStore` exists because rotation is not the harness's own operation: the provider SDK exchanges an expired access token for a fresh one and writes the result back. `modify` is the only write path and is serialized per route across every writer the backing store can see, because the correct writes all depend on the current value — a rotation must not resurrect a token set a sign-out just removed, and two requests observing the same expired token must produce one refresh rather than two. A refresh token is single-use, so a lost update here signs the user out for good.

## Providers

[`dsh-llm-oauth-local`](../llm-oauth-local/README.md) keeps the token sets in an owner-only `$DSH_HOME/.oauth.json` and runs the sign-in flows the installed pi-ai catalog ships. The seam shape leaves room for keyring- and broker-backed providers; nothing in it assumes a local file or a loopback callback.

## Consumers

[`dsh-llm-pi-ai`](../llm-pi-ai/README.md) builds its provider collection over this store, so a signed-in route authenticates with the subscription. [`dsh-command-login`](../command-login/README.md) is the human half: `/login` and `/logout` over whichever UI is composed.

## Model Experience

Indirectly, through the consuming LLM adapter, which owns every model-visible surface a resolved token authorizes.

#### KV Cache effect

No direct invalidation; tokens never enter a request prefix. Switching a route between the key path and the subscription path does change the request's system prompt on providers that require their own identity preamble, which invalidates that route's prefix once.

## Known Limitations and Deferred Work

- **No enumeration of accounts within a provider** — one token set per route, so a user with two subscriptions on one provider cannot hold both.
- **Sign-out is local only** — nothing here can revoke the authorization itself; that lives on the provider's own account page.
- **No expiry notification** — a status surface re-reads `accounts()` on its own navigation, or on `llm-oauth/updated`.
