# @deepseek-ai/dsh-command-status

Human-facing `/status` read over the receiving agent. It reports session identity, current agent lifecycle state, and model-visible surface size without a model turn.

## Command contract

`/status` returns `Session <id> — agent is <idle|running>. Context holds <n> message(s).` from one live agent snapshot. Trailing input is ignored. The command mutates no domain state and appends only `command/run` / `command/done` lifecycle events.

## Composition

```yaml
- id: command-status
  name: '@deepseek-ai/dsh-command-status'
```

## Model Experience

### Live status

#### What the model sees

Nothing. The `/status` report is direct UI output and does not enter model history.

#### Token effect

No model tokens are added; the message count is a positional surface-node count, not token pricing.

#### KV Cache effect

No effect because the session surface is not changed.

## Known Limitations and Deferred Work

- **Point-in-time result** — status may change immediately after the command reads it.
- **Minimal report** — provider/model selection, persistence health, and subagent state belong to their own diagnostics and are not included.
