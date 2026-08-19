# llm/ — LLM capability family

English | [中文](README.zh.md)

The LLM seam and its provider adapters. The `llm` package owns both the Service Definition and Consumer roles: the abstract service, content-block vocabulary, and stream-chunk assembler. Provider adapters register on `ctx.llm`. All **product** packages.

| Package | Role | ctx key |
|---|---|---|
| [`llm/`](llm/README.md) | LLM service and shared streaming vocabulary | `ctx.llm` |
| [`token-meter/`](token-meter/README.md) | Replay-aware token measurement | `ctx.tokenMeter` |
| [`llm-retry/`](llm-retry/README.md) | Provider-scoped retry policy | listens to `agent/request-error` |
| [`llm-deepseek/`](llm-deepseek/README.md) | Direct DeepSeek adapter | registers on `ctx.llm` |
| [`llm-pi-ai/`](llm-pi-ai/README.md) | Multi-provider pi-ai adapter | registers on `ctx.llm` |
| [`llm-oauth/`](llm-oauth/README.md) | Subscription sign-in seam | `ctx.llmOAuth` |
| [`llm-oauth-local/`](llm-oauth-local/README.md) | File-backed token store and catalog sign-in flows | registers `ctx.llmOAuth` |
| [`command-login/`](command-login/README.md) | Human `/login` and `/logout` | registers commands |

Adapters register provider routes on the seam; retry and token measurement remain separate consumers. Subscription sign-in is its own seam beside them, because a provider subscription authenticates with a rotating token the adapter hands to its SDK rather than a value configuration can name. The child READMEs own routing, metadata, replay, and provider-wire details; the [LLM architecture decisions](../../.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.md) own the rationale.

The subsystem reference — messages and blocks, the model request, the `StreamChunk` protocol, the adapter contract — is [docs/subsystems/llm-streaming.md](../../docs/subsystems/llm-streaming.md) (token measurement: [token-meter.md](../../docs/subsystems/token-meter.md)); see the [twin adapters](../../.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.md), [replay token meter](../../.agents/notes/implemented/architecture/2026-07-15-replay-token-meter-service.md), and [routed model context](../../.agents/notes/implemented/architecture/2026-07-20-routed-model-context-and-compaction-policy.md) Agent Notes.
