# @deepseek-ai/dsh-command-context

Human-facing `/context` inspection over [`ctx.tokenMeter`](../../llm/token-meter/README.md). One measurement reports surface size, the first heaviest message, and complete request pressure.

## Command contract

`/context` returns exactly three lines: model-visible surface message count and heuristic tokens; the first maximum-priced node and its zero-based position (or `none`); and total request pressure labeled as provider-measured, heuristic, or without a baseline. Trailing input is ignored.

## Composition

```yaml
- id: command-context
  name: '@deepseek-ai/dsh-command-context'
```

The composition must provide `commands` and `tokenMeter`.

## Model Experience

### Context inspection

#### What the model sees

Nothing. `/context` reads model-visible state but its input and result remain direct UI output.

#### Token effect

No model tokens are added. Reported numbers describe the current request and surface; they do not mutate either.

#### KV Cache effect

No effect because no message or request header is changed.

## Known Limitations and Deferred Work

- **Heuristic message prices** — individual node and surface figures use the token meter estimator even when total pressure can reuse provider usage.
- **Position, not event sequence** — the heaviest-node position is its current surface index; replacements can make event sequence numbers non-monotonic.
