# @deepseek-ai/dsh-command-help

Human-facing `/help` discovery over [`ctx.commands`](../commands/README.md). The receiving agent’s effective scoped registry is rendered without a model turn.

## Command contract

`/help` returns one name-sorted `/<name> — <description>` row for every command the receiving agent can resolve. Trailing input is ignored. The command reads live registry state and appends only the executor-owned `command/run` / `command/done` lifecycle pair.

## Composition

```yaml
- id: command-help
  name: '@deepseek-ai/dsh-command-help'
```

The shipped base bundle mounts the command beside the shared command registry.

## Model Experience

### Command discovery

#### What the model sees

Neither the `/help` input nor its result enters a model request. Interactive command adapters render the result directly.

#### Token effect

No model tokens are added. The command reads only registry metadata.

#### KV Cache effect

No effect: no model request or model-visible session event is produced.

## Known Limitations and Deferred Work

- **Plain text only** — adapters receive one textual catalog rather than grouped or localized command metadata.
- **Current scope only** — the result reports commands resolvable by the receiving agent, not commands available in other agent scopes.
