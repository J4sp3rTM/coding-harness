# dsh-llm-oauth-local

English | [中文](README.zh.md)

File-backed provider for the [subscription sign-in seam](../llm-oauth/README.md). It owns two things: the durable token document, and the sign-in flows it runs.

## The token document

Token sets live in `$DSH_HOME/.oauth.json`, one entry per provider route, created and replaced at `0600` inside a `0700` home. A document that arrives wider is refused before its contents are read at all — it holds nothing but secrets, so serving them out of a world-readable file would make the mode meaningless. POSIX only: Windows has no mode to inspect, so the check is skipped rather than faked.

Every read goes to the file, and every write is a read-render-commit cycle under a cross-process writer lock. This is not caution about concurrency in general: token rotation *is* a read-modify-write, a second harness process or a second request can enter it at the same moment, and the refresh token a provider hands back is single-use — overwriting it with the one that was current a moment ago leaves nothing that can be exchanged again, which signs the user out for good. In-process writers queue on one promise chain per route before contending for the file lock, so the common case never pays a filesystem retry.

The document declares a format version. One written by another version is refused rather than migrated, and the diagnostic says to remove it and sign in again — re-earning a token costs one browser round trip, while guessing at an unknown format costs the account.

An entry missing a field reads as signed out rather than failing: a truncated or hand-edited entry is repaired by signing in, and the alternative is a value shaped like a token reaching a provider request. An empty refresh token is valid for a provider that issues a non-refreshable access grant.

## The flows

The flows are not implemented here. Every OAuth-capable provider in the installed pi-ai catalog already carries one — the authorization endpoint, the PKCE exchange, the loopback callback server, the paste-the-redirect fallback, and the refresh grant — and the same catalog owns the request path that turns a stored token into the identity headers each provider expects. Reimplementing a flow beside that would leave two descriptions of one protocol, and only one of them would be the one requests actually take.

Which routes are offered is therefore the catalog's answer, and a pi-ai upgrade that adds a subscription provider offers it here without an edit. As installed, that is `anthropic` (Claude Pro/Max), `openai-codex` (ChatGPT Plus/Pro), `github-copilot`, `kimi-coding`, `openrouter`, `radius`, and `xai`.

## Config

```yaml
- id: llm-oauth
  name: '@deepseek-ai/dsh-llm-oauth-local'
  config:
    # Token document; defaults to `.oauth.json` under the harness home.
    path: /run/secrets/dsh-oauth.json
    # Harness home used when `path` is omitted; defaults to $DSH_HOME or ~/.dsh.
    dshHome: /var/lib/dsh
    # Offer only these routes; omit to offer every catalog route that can be
    # signed into. A route the catalog cannot sign into fails at load rather
    # than being skipped, so a typo names itself instead of quietly removing
    # the option someone meant to keep.
    providers:
      - anthropic
      - openai-codex
```

## Using a subscription

Signing in stores a token set; the pi-ai adapter then activates an unconfigured catalog route, exposes its models, authenticates it with the subscription, and rotates refreshable tokens under this store's lock. A profile in the `llm-pi-ai` settings section remains authoritative when present, and [that package's README](../llm-pi-ai/README.md) owns the `auth` field and the precedence between a stored sign-in and a configured key.

Signing out removes the token set from this machine. It does not end the session on the provider's side; nothing here can, and the authorization is revoked on the provider's own account page.

Subscription plans carry their own terms about which clients may use them. Signing in here presents the provider's own coding-agent client identity, because that is what the OAuth path requires; whether a given plan permits that is between the account holder and the provider.

## Model Experience

Indirectly, through the consuming adapter, which owns every model-visible surface; this package only stores the credential that authorizes its requests.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The loopback flows are Node-only** — the catalog flows open an HTTP callback server on the host, so a Host running where `127.0.0.1:53692` is unreachable from the user's browser depends on the paste-the-redirect prompt.
- **No orphaned-lock recovery** — a writer lock left behind by a killed process is removed by an operator, because file age cannot prove its owner stopped.
- **One token set per route** — a user with two accounts on one provider cannot hold both.
