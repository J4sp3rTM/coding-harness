# @deepseek-ai/dsh-command-rename

Human-facing `/rename <new title>` adapter over [`ctx.sessionTitle`](../session-title/README.md). An accepted rename pins the normalized title and stops automatic generation until an explicit refresh.

## Command contract

| Input | Result |
|---|---|
| `/rename <title>` | Appends one user-owned `session/title` event and returns the normalized title. |
| `/rename` or whitespace only | `Usage: /rename <new title>` with no title event. |
| Invalid normalized title | Returns the session-title service’s input error. |

On success, `command/done.sourceEventSeq` points at the authoritative `session/title` event. Unexpected service failures reject dispatch instead of becoming input errors.

## Composition

```yaml
- id: command-rename
  name: '@deepseek-ai/dsh-command-rename'
```

## Model Experience

### Session rename

#### What the model sees

The command lifecycle and `session/title` event are log-only. Session titles are UI metadata and do not enter model requests.

#### Token effect

No model tokens are added and automatic title generation is avoided after the explicit pin.

#### KV Cache effect

No effect because the model-visible conversation surface is unchanged.

## Known Limitations and Deferred Work

- **One session only** — the command always targets the receiving agent’s live session.
- **No unpin command** — restoring automatic generation remains the explicit session-title refresh path.
