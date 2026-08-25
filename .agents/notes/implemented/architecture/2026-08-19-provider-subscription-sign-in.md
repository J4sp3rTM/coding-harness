# Agent Note: Provider subscription sign-in

Status: implemented

English | [中文](2026-08-19-provider-subscription-sign-in.zh.md)

## Problem

Every credential the harness could hold was an API key. The credential seam is built for exactly that: configuration names a reference, a provider owns the value, and consumers re-resolve it per operation. A provider *subscription* — Claude Pro/Max, ChatGPT Plus/Pro — fits none of it. There is no stable value for configuration to name; the credential is a token set that the provider SDK rotates behind the harness's back, on its own schedule; and obtaining one at all needs a browser round trip that no configuration file can express.

So a user paying for a plan they already have could not use it here, and the adapter said so out loud: `llm-pi-ai` withheld `openai-codex` from its configurable-provider directory entirely, because the only method that route offers is OAuth and nothing in the harness could produce an OAuth credential.

## Decision

Subscription sign-in is its own capability seam beside the credential seam, not an extension of it.

`ctx.llmOAuth` ([`dsh-llm-oauth`](../../../../packages/llm/llm-oauth/README.md)) owns the vocabulary: the routes that can be signed into, non-secret account facts for status surfaces, an interaction the flow reports through and asks through, and — separately — the token store. The split matters: `status()` and `accounts()` can be handed to any surface because they carry no secret, while `tokens()` exists for one caller, the LLM adapter, because rotation is not the harness's operation to perform.

[`dsh-llm-oauth-local`](../../../../packages/llm/llm-oauth-local/README.md) provides it over an owner-only `$DSH_HOME/.oauth.json` under a cross-process writer lock, and runs the sign-in flows the installed pi-ai catalog already ships rather than reimplementing any of them.

[`dsh-llm-pi-ai`](../../../../packages/llm/llm-pi-ai/README.md) builds its `Models` collection over a credential store that reads through to the seam, and each request resolves one of three postures: a profile pinning `auth: subscription`, a profile pinning `auth: api-key`, or — the default — a stored sign-in owning the route with the key path underneath.

[`dsh-command-login`](../../../../packages/llm/command-login/README.md) is the human half, `/login` and `/logout` over `ctx.userQuestions`.

Provider prompts map directly onto questions. A reported authorization URL is carried into the prompt that follows it. A reported device code has no following prompt because the provider polls independently, so the command opens an acknowledgement question immediately and races it against the provider flow: completion dismisses the question, while cancellation aborts the polling flow. The [local browser hand-off](../feature/2026-08-19-automatic-provider-login-browser.md) opens the same HTTPS target when the command host has a desktop route; the rendered question remains authoritative for remote and headless hosts.

The command descriptor marks `/login` input as optional. A bare Web invocation therefore executes and opens the route chooser, while an explicit provider still uses the ordinary argument path.

### Why the flows are not ours

Every OAuth-capable provider in the installed pi-ai catalog carries a complete flow — authorization endpoint, PKCE exchange, loopback callback server, paste-the-redirect fallback, refresh grant — and the *same catalog* owns the request path that turns a stored token into the identity headers the provider requires. Those two halves have to agree: Anthropic's OAuth path sends specific `anthropic-beta` opt-ins, a CLI user agent, and an identity preamble, and a token obtained by our own flow would still have to travel that path. Writing our own flow beside it would leave two descriptions of one protocol with only one of them load-bearing.

The consequence is that the offered routes are the catalog's answer, not a list here: a pi-ai upgrade adding a subscription provider offers it without an edit, and seven routes are offered today rather than the two that motivated the work.

### The store's serialization is not general caution

`modify` is the only write path and is serialized per route across every writer the backing store can see. A refresh token is single-use: overwriting a rotated one with the value that was current a moment earlier leaves nothing that can be exchanged again, and the user is signed out for good. Two harness processes, two browser tabs, and two concurrent requests can all enter that read-modify-write, so an in-process promise chain per route sits in front of a `withFileLock` cycle on the document.

### App attribution follows each provider's OAuth identity requirement

Anthropic subscription requests are the one deliberate exception to the [mandatory attribution rule](2026-06-21-mandatory-app-attribution-headers.md). The harness merges its `user-agent` last into pi-ai's request headers, which is exactly where Anthropic's OAuth path puts the CLI identity its endpoint requires. Sending attribution there replaces that identity and the endpoint refuses the request, so the header is withheld.

Other subscription providers retain harness attribution. OpenAI Codex replaces it later with its own `User-Agent` and `originator`, so the request keeps the provider SDK's identity. xAI supplies no competing identity, so withholding attribution would only discard a fact.

## Alternatives considered

**Store the token set through the credential seam.** A `CredentialRef` could name a JSON blob. It fails on rotation: the seam's providers own storage but not a serialized read-modify-write, so two concurrent refreshes would race and one would lose a single-use token. It also fails on `describe()`, which answers "configured, from which layer, writable" — none of which says whether a subscription is signed in or when its access token expires. The two seams answer different questions and share only the word "credential".

**Put the sign-in flows and the token store in `llm-pi-ai`.** Fewer packages, and the catalog flows already live there. Rejected because the seam then has no existence apart from one adapter: a second adapter family, a keyring-backed store, or a Host that signs in on behalf of a browser client would each have to reach into the pi-ai package. The store is also the one place a token is written, which is worth an owner that a request path cannot reach past.

**Make the sign-in seam a required injection of `llm-pi-ai`.** Rejected: an api-key-only deployment composes no sign-in service, and making the adapter wait for one would take every configured route out of service to add a feature nobody asked for. The seam is read per request through `ctx.get('llmOAuth')`, which also lets a sign-in service mounted *after* the adapter reach routes already registered.

**Require `auth: subscription` before a stored sign-in is used.** Explicit, and it matches the repository's preference for explicit over implicit. Rejected as the default because it makes `/login` insufficient on its own: the user would sign in, see nothing change, and have to edit `settings.yaml` to finish. The mode is still nameable, and naming it is what turns off the fallback — which is the direction where implicitness actually costs something, since falling back silently moves a request onto an unrelated account's key.

**Require the human to open every sign-in URL.** The [local browser hand-off](../feature/2026-08-19-automatic-provider-login-browser.md) supersedes this presentation choice without assuming that every Host owns a display: desktop detection permits the hand-off only on a local GUI route, while the rendered URL and loopback/paste fallback retain the remote-Host behavior.

## Consequences

A user with a Claude Pro/Max or ChatGPT plan reaches it with `/login` and no configuration edit, and `/logout` puts the route back on its key. `openai-codex` becomes a configurable provider for the first time, and six other catalog routes gain a sign-in nobody had to enumerate.

The cost is a third authentication posture per route, which the adapter must decide before each request and which its README explains alongside `apiKeyEnv`. Anthropic subscription traffic carries no harness attribution because its endpoint requires the OAuth client's CLI identity; other subscription routes retain attribution unless their provider SDK replaces it.

Signing out is local only: nothing here can revoke an authorization, which lives on the provider's own account page. Subscription plans carry their own terms about which clients may use them, and the sign-in presents the provider's own coding-agent identity because the OAuth path requires it; whether a plan permits that is between the account holder and the provider, and the harness does not decide it.

## Testing

The store's serialization, permission refusal, format-version refusal, and partial-entry tolerance are pinned in `packages/llm/llm-oauth-local/tests/store.spec.ts`. The seam's commit-event containment and the provider's flow orchestration have their own suites. The command suite and a real Loader composition pin immediate device-code presentation, cancellation, and human-only output. `packages/llm/llm-pi-ai/tests/subscription.spec.ts` drives all three request postures against a local endpoint and asserts provider-specific attribution, including that a signed-out `auth: subscription` route sends nothing at all rather than falling back.
