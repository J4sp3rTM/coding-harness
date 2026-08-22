# @deepseek-ai/dsh-tool-development-workflow

English | [中文](README.zh.md)

The model-facing `delegate_work` tool delegates a minimum set of planned coding work units through `ctx.workflowEngine`. It is a fixed trusted orchestration script: the model supplies the objective, plan, units, and an explicit independent-scope assertion, but cannot replace the orchestration or report schema.

T3 is selected only for simple low-risk work marked `repetitive`. `simple` + `low` alone is T2, not T3. T2 is the default for ordinary or complex implementation, inspection, and validation. T1 is reserved for units with `exceptional: true` (architecture, difficult diagnosis, exceptional risk, or high-value final review). The model cannot select a tier. A call whose every unit is a tiny non-repetitive 1–2 file change is refused so the parent keeps it; `refuseTinyNonRepetitive` (default true) and `tinyMaxFiles` (default 2) make that configurable. The host settings namespace `development-workflow` optionally overrides each tier's provider, model, and model-specific reasoning effort; omitted fields inherit the calling agent's route or use the selected model's provider default. Member start events record that configured or inherited route, including whether effort was supplied or left to the provider default. Changes apply to the next call, while an in-flight run keeps its captured routes. Execution is sequential by default. `parallel: true` requires every unit to declare non-overlapping scopes, including parent/child path overlap, and remains unsafe for generated or other shared-workspace state.

Implementation workers may edit only their declared scopes. Inspection, validation, and review workers are explicitly read-only; validation reports exact relevant checks, and review reports concrete defects. Workers return `summary`, `changedFiles`, `validationEvidence`, `risks`, and `followUps`. Their reports are evidence for the parent, not certification. The parent must inspect diffs, run authoritative validation, fix issues, and decide whether another delegation is necessary. Top-level runs and members are recorded through the shared `tool-workflow/*` durable events.

## Config

| Key | Default | Meaning |
|---|---:|---|
| `maxWorkUnits` | `8` | Per-call and deployment work-unit ceiling. |
| `maxHandoffChars` | `16384` | Serialized workflow result ceiling. |
| `maxResultChars` | `16384` | Parent-facing rendering ceiling. |
| `refuseTinyNonRepetitive` | `true` | Refuse a call whose every unit is a tiny non-repetitive 1–2 file change. |
| `tinyMaxFiles` | `2` | Declared-scope ceiling still treated as a tiny change when refusing. |

## Model Experience

### System prompt

#### What the model sees

The tool adds concise guidance to plan first, skip tiny non-repetitive 1–2 file changes, use T3 only for repetitive work, and review and validate every result.

##### delegate_work guidance

```markdown
Use delegate_work only after planning work that needs workers: repetitive mechanical edits, multi-file implementation, or exceptional review. Do not delegate a tiny non-repetitive 1-2 file change. T3 requires repetitive work; T2 is the default for ordinary implementation; T1 only when exceptional. Always inspect diffs and run authoritative validation.
```

#### Token effect

Small fixed guidance cost on each request where this tool is in scope.

#### KV Cache effect

Prefix-stable while the tool guidance remains unchanged; activation, disposal, or wording changes can invalidate reuse from this section.

### Tool schema and result

#### What the model sees

The model submits `objective`, `plan`, `workUnits`, and optional `parallel`; the shared workflow envelope is described by the generated [`workflow` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-workflow). A successful result contains the workflow run id, agent count, and structured reports. Cancellation and engine failures are errors.

#### Token effect

Each call adds the bounded work-unit schema and the structured result to the parent context.

#### KV Cache effect

The schema and guidance remain prefix-stable while definitions and visibility are unchanged; calls and results append afterward.

## Known Limitations and Deferred Work

- Workers share the workspace; explicit parallel execution can still conflict if scopes are incomplete or a worker changes shared generated state.
- Route inheritance follows the parent at run time; this tool does not certify a provider/model/effort combination's quality or availability.
- Tier routes are configured from Settings → Models when the host mounts a settings provider; a deployment without that namespace uses parent-route inheritance for every tier.
