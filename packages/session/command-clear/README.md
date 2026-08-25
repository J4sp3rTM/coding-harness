# @deepseek-ai/dsh-command-clear

Human-facing `/clear`: drop the model's conversation context while keeping the same session. The whole model-visible surface is shadowed behind one durable checkpoint, exactly as compaction shadows a summarized range. Earlier events stay in the append-only log; only the derived surface changes.

## Command contract

`/clear` takes no arguments; trailing input returns the usage error. It runs only while the receiving agent is `idle` — an in-flight turn returns a busy error rather than racing the driver appending to the same log. An already-empty surface reports that and appends nothing.

Otherwise the command replaces the complete surface span (first through last node) with one plugin-sourced `user/message` checkpoint, then flushes the session before reporting success, so a crash immediately after the acknowledgement cannot resurrect the cleared context. The success text names how many messages were cleared and states that the session and its full history are preserved.

The whole surface is a complete, tool-pairing-balanced span by construction, so shadowing first-through-last can never orphan a tool call.

## Composition

```yaml
- id: command-clear
  name: '@deepseek-ai/dsh-command-clear'
```

## Model Experience

### Context clearing

#### What the model sees

Every message before the checkpoint disappears from the assembled request. The model sees the fixed checkpoint text as a plugin-sourced user message, then whatever follows it.

##### Checkpoint message

```markdown
The earlier conversation in this session was cleared at the user's request. No prior messages remain in context; continue as a fresh start.
```

#### Token effect

Input tokens drop to the checkpoint plus any later turns. The shadowed events remain on disk but are never re-sent.

#### KV Cache effect

The prefix is rewritten at the checkpoint, so the next request misses cache for the whole conversation and re-establishes a new prefix from the checkpoint forward.

## Known Limitations and Deferred Work

- **Idle-only** — clearing is refused while a turn is in flight; there is no queued-clear that applies when the agent next goes idle.
- **All-or-nothing** — the command shadows the complete surface; a partial or range-scoped clear belongs to compaction, which owns summarized ranges.
