# @deepseek-ai/dsh-command-list-agents

Human-facing `/list-agents` projection over [`ctx.subagents.listChildren()`](../subagent/README.md). It lists direct durable child sessions without reading their transcripts or starting a model turn.

## Command contract

Child rows preserve runtime order and report label (falling back to id), one-shot or continuable mode, running or inactive activity, and whether descendants exist. Corrupt or unavailable child records become diagnostic rows instead of disappearing. An empty listing returns `No subagents have been started from this session.` Cancellation returns `Subagent lookup cancelled.`

## Composition

```yaml
- id: command-list-agents
  name: '@deepseek-ai/dsh-command-list-agents'
```

## Model Experience

### Direct-child listing

#### What the model sees

Nothing. The `/list-agents` listing is direct command output and does not inject child metadata into the parent model request.

#### Token effect

No model tokens are added; durable child identity projections are read from persistence as needed.

#### KV Cache effect

No effect because neither parent nor child model-visible history changes.

## Known Limitations and Deferred Work

- **Direct children only** — use the programmatic descendant listing for the full tree.
- **No final outcome** — activity reports whether a session is resident, not whether its last turn succeeded or failed.
