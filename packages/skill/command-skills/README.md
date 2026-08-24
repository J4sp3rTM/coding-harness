# @deepseek-ai/dsh-command-skills

Human-facing `/skills` discovery over [`ctx.skills`](../skill/README.md). It awaits one catalog view and renders stable name-sorted rows without a model turn.

## Command contract

`/skills` returns `• <name> — <description>` for each resolved skill. Skills unavailable to human invocation gain ` (model-only)`. An empty catalog returns `No skills are available.` Trailing input is ignored, and request cancellation returns `Skills lookup cancelled.`

## Composition

```yaml
- id: command-skills
  name: '@deepseek-ai/dsh-command-skills'
```

The composition must also provide `commands` and `skills`.

## Model Experience

### Skill discovery

#### What the model sees

Nothing. The `/skills` human catalog is direct command output; the model’s own skill catalog remains owned by the skill consumer.

#### Token effect

No model request is made and no model-visible text is appended.

#### KV Cache effect

No effect because tool schemas, system prompts, and conversation messages are unchanged.

## Known Limitations and Deferred Work

- **Summary rows only** — skill bodies, source details, and `whenToUse` guidance remain available through the skill loader.
- **No filtering arguments** — the command always lists the complete resolved catalog for its current viewing scope.
