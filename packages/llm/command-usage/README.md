# @deepseek-ai/dsh-command-usage

Human-facing `/usage` projection over [`ctx.tokenMeter`](../token-meter/README.md). It reports the latest provider usage anchor when available and the session’s current request pressure.

## Command contract

`/usage` returns two lines. A provider-backed baseline reports the latest call’s input/output token counts; an estimated or empty baseline explains that no provider usage is available. The second line always reports current context pressure. Trailing input is ignored.

The measurement replays the durable session tail through the token meter. The command adds no usage sample and appends only `command/run` / `command/done`.

## Composition

```yaml
- id: command-usage
  name: '@deepseek-ai/dsh-command-usage'
```

The composition must also provide `commands` and `tokenMeter`.

## Model Experience

### Usage report

#### What the model sees

Nothing. The `/usage` report is rendered directly by the command adapter.

#### Token effect

No model request is made. Reading the token meter does not change later request pricing.

#### KV Cache effect

No effect because the model-visible surface is unchanged.

## Known Limitations and Deferred Work

- **Latest call, not billing ledger** — provider usage is the latest reusable measurement anchor, not an account-wide or cumulative cost report.
- **Estimated fallback** — providers that do not report usage yield heuristic context pressure.
