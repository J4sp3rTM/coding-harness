# @deepseek-ai/dsh-web-search-duckduckgo

English | [中文](README.zh.md)

A keyless DuckDuckGo `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It queries DuckDuckGo's HTML endpoint (`html.duckduckgo.com/html/`) with a form POST and parses the server-rendered results into the seam's normalized sources. It needs no credential, which is what makes it usable as the ordered fallback behind a credentialed search provider such as [`dsh-web-search-deepseek`](../web-search-deepseek/README.md).

This is an **implementation** package: it registers a provider into `ctx.web`, it owns no key, and it does not register a model-facing tool. It is a function/namespace plugin (`inject: ['web']`).

## Responsibility split

The provider owns transport and parsing: the form-encoded POST, redirect refusal, response byte cap, UTF-8 decoding, and markup parsing into `WebSearchSource[]`. `@deepseek-ai/dsh-tool-web` owns presentation; `ctx.web` owns selection (including the ordered preference list this package typically sits second in), `maxResults` truncation, and error vocabulary.

Redirects are refused in the client (`redirect: 'error'`, surfaced as `WEB_PROVIDER_ERROR`) even though the request carries no secret: the configured endpoint stays the only request target, per the web packages' redirect rule. A non-200 status — including the endpoint's 202 anomaly/challenge page — fails with `WEB_PROVIDER_ERROR`; an empty result set on a 200 page is a valid empty result.

## Config

| Key | Default | Meaning |
|---|---|---|
| `baseURL` | `https://html.duckduckgo.com/html/` | HTML-endpoint base URL; the search form is POSTed here. |
| `maxResponseBytes` | `2_000_000` | Inclusive response size cap in bytes; a declared or streamed body over the cap fails with `WEB_FETCH_TOO_LARGE` rather than parsing cut-off markup. |

Both fields are re-validated when the plugin applies: misconfiguration throws at load instead of registering a provider whose searches would fail.

## Model Experience

### Keyless web_search results

#### What the model sees

The model's `web_search` call returns citeable `url`/`title`/`snippet` sources plus `publishedAt` dates where the endpoint supplies them. Unlike the DeepSeek route, no auxiliary model call happens: one search is one HTTP scrape.

#### Token effect

None directly — this package issues no model request; results reach the conversation only through [`dsh-tool-web`](../tool-web/README.md) tool output.

#### KV Cache effect

No effect; the consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Markup scraping has no contract** — the HTML endpoint is undocumented and its markup changes without notice; a parser breakage surfaces as empty or missing fields at runtime. The parser is tested against a recorded live-endpoint page (`tests/fixtures/`), so upstream changes fail tests first, but re-recording that fixture is manual work.
- **Anti-bot challenges are a hard failure** — datacenter IPs frequently receive a 202 challenge page instead of results; the provider reports `WEB_PROVIDER_ERROR` naming the status rather than retrying or solving challenges.
- **Click-routing URLs are unwrapped best-effort** — result links route through `duckduckgo.com/l/?uddg=…`; results whose target cannot be recovered are skipped silently rather than guessed.
- **Publication dates are date-only** — the endpoint's extras span carries a bare calendar date; no time-of-day or timezone exists to preserve.
