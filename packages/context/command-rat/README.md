# @deepseek-ai/dsh-command-rat

Human-facing `/rat`: append a durable custom system prompt to the current session without touching the deployment persona. The selected text is recorded as a last-wins session event, and the prompt section reads that fold during assembly, so a resumed session rebuilds the same model-visible input without a process-local mirror.

## Command contract

`/rat <text>` records the trimmed text and reports whether it appended or replaced the previous value. `/rat` with no text removes an active prompt; with none active it returns the usage line. Text larger than the configured limit is rejected with its measured size, and nothing is appended.

The value is stored in the last-wins `rat/prompt` session event (`null` removes the section), so the durable log alone determines the active prompt.

## Configuration

```yaml
- id: command-rat
  name: '@deepseek-ai/dsh-command-rat'
  config:
    maxBytes: 8192
```

`maxBytes` caps one custom prompt measured in exact UTF-8 bytes — the same bytes that enter the durable JSON event, not JavaScript string length. It must be a positive safe integer; anything else fails loudly at load.

## Model Experience

### Custom system prompt

#### What the model sees

The recorded text as its own system-prompt section, ordered with the other sections and applied from the next turn. An empty fold contributes nothing.

##### Active prompt

```markdown
<recorded text, verbatim>
```

#### Token effect

The prompt's tokens are added to every later request until it is replaced or removed.

#### KV Cache effect

Changing the value rewrites a system-prompt section, so the shared prefix changes and the next request re-establishes cache from that section forward.

## Known Limitations and Deferred Work

- **One value per session** — the event is last-wins, so there is no stack of layered custom prompts and no per-agent scoping inside one session.
- **Byte cap only** — the limit bounds size, not content; the text is not validated, templated, or checked against the deployment persona it augments.
