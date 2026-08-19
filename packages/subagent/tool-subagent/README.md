# @deepseek-ai/dsh-tool-subagent

English | [中文](README.zh.md)

The model-facing delegation tool over one configured `ctx.subagents` provider. Changing the provider changes transport without changing the execution contract.

## Provider selection and lifecycle

Each plugin instance binds one `provider` to one `toolName`; the model receives no provider selector. Load another distinctly named instance to expose another transport. The tool registers only while its provider exists, avoiding sibling load-order and provider-reload dependencies. Its description follows `provider.inheritsParentContext`: fresh children require standalone prompts, while forked children already see completed parent turns.

A foreground call passes the execution signal through startup and execution, awaits `run.result`, and always awaits `run.dispose()` before returning. Only `completed` returns the canonical `{ kind: 'foreground', runId, output: JsonValue[] }`, rendered as the same final text; abort, refusal, token limit, and other failures become errored tool results whose message appends the child's preserved partial text (the `SubagentResult.output` selection) after the stop-reason headline, so a truncated answer is never reported as success yet never silently lost. If result collection and disposal both reject, the errored result preserves both diagnostics.

`backgroundMode` selects the available background route; omitted `run_in_background` values default to foreground waiting. An explicit `false` always waits for the result. In `one-shot` mode, an explicit `true` registers a plain parent-owned Task and returns canonical `{ kind: 'background', jobId }`, rendered as `started background subagent job <id>`, even when the provider supports continuable children. Generic task tools own its later status, collection, cancellation, and notices. In `continuable` mode, an explicit `true` requires a provider with the `prepareContinuable` capability, calls `ctx.subagents.startContinuable()`, and returns `{ kind: 'continuable', subagentId }`, rendered as `started subagent <childId>`. That route resolves at inbox acceptance: the child owns its own turns from there, so the call neither waits for nor collects a result. The child's transcript by that id remains the source of its detailed output, and the optional global `send_message` tool sends it more work. The continuation service delivers one settlement notice whenever the child's Activation ends, containing its outcome and any final assistant message independently of `report`. Starting continuable work does not require `send_message` to be loaded. See the [background subagent Agent Note](../../../.agents/notes/implemented/feature/2026-07-08-background-subagent-tasks.md), the [continuable subagents Agent Note](../../../.agents/notes/implemented/feature/2026-07-28-continuable-subagent-conversations.md), and the [background-first delegation Agent Note](../../../.agents/notes/implemented/feature/2026-08-11-background-first-continuable-delegation.md).

`toolFilter` changes the child's global tool layer but is not a parent-derived authority ceiling. See the [agent-scope security non-goal](../../../.agents/notes/implemented/architecture/2026-07-08-agent-scope-contexts.md#security-and-authority-are-non-goals).

## Config

| Key | Meaning |
|---|---|
| `provider` (required) | Provider name (`spawn`, `fork`, `acp`, ...). |
| `toolName` | Model-facing name, default `subagent`; distinct for every loaded instance. |
| `enableRunInBackground` | Exposes background mode, default `true`; disabling also rejects forced background calls. |
| `backgroundMode` | Background lifecycle policy, default `one-shot`. Calls wait for results by default; explicit background calls use either a parent-owned Task (`one-shot`) or a durable child (`continuable`). |
| `agentOptions` | Provider-specific child `provider`, `model`, and positive `maxTokens`; the in-process provider treats explicit values as overrides of inherited parent options. |
| `persona` | Per-child persona; requires provider `persona` capability. |
| `toolFilter` | Per-child global-tool restriction; requires `toolFilter` capability. |
| `maxDepth` | Absolute delegation-depth cap, default `3` (`0` forbids delegation); a numeric cap requires the `depthLimit` capability and fails the mount without it. `'provider-managed'` sends no cap for an out-of-process provider whose budget belongs to the child harness. The tool stays visible at the cap; each attempted start checks the calling agent's current depth and returns an errored tool result when rejected. |

## Concurrency

Foreground and background calls are concurrency-safe: sibling delegations in one assistant message overlap under the loop's rolling pool (`maxParallelToolCalls`), and results still commit in model order. Children work in their own sessions and a run never mutates the parent session; the one-shot background form's one parent-owned write — registering a Task — is a synchronous, commutative insertion that tolerates concurrent dispatch, so overlapping background calls acquire their job ids in dispatch-race order. Coordinating sibling workspace effects belongs to the model, exactly as it already does for background and continuable children. See the [parallel subagent Agent Note](../../../.agents/notes/implemented/feature/2026-08-09-parallel-subagent-delegations.md) and the [parallel tool-call Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md).

## Model Experience

### Tool schema

#### What the model sees

The generated default [`subagent` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-subagent) under this instance's configured name while its provider exists. Provider context inheritance changes the tool and prompt descriptions. Enabled background mode adds `run_in_background`, which defaults to `false`; explicit `true` selects the configured background route. While the tool is visible in an assembly's scope, a `tool:<toolName>` system-prompt section tells the model to wait for results by default, start independent delegations together in one assistant message so they run concurrently, and use background mode only when the result is not needed immediately; a tool restriction removes both its schema and this guidance.

#### Token effect

Fixed schema cost per parent request; each provider instance adds one schema, and each continuable instance adds one short system-prompt section.

#### KV Cache effect

Prefix-stable while provider instances, names, descriptions, and schemas are unchanged. Provider registration lifecycle may invalidate parent reuse from the first changed tool definition.

### Foreground result

#### What the model sees

The call retains the description and prompt. Success contains only the child's final text; other outcomes become `Error: <message>`. Intermediate child steps stay out of the parent.

#### Token effect

The prompt and result remain in parent history until compaction; child working context remains in the child.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Background result

#### What the model sees

Start returns exactly `started subagent <childId>` in configured continuable mode, or `started background subagent job <id>` in configured one-shot mode. In one-shot mode the generic task surface provides later status, final output, cancellation responses, and notices. In continuable mode this tool returns no result of its own; the child's settlement reaches the parent as a [service-owned notice](../subagent/README.md#settlement-notice), an independently loaded `send_message` tool delivers follow-ups, and the child's transcript by its id is the source of its detailed output.

#### Token effect

The acknowledgement is retained; a one-shot final output enters parent history only when collected or injected, while a continuable child's output never returns through this tool — its settlement notice arrives independently of any tool result.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Background runs expose no result through this tool** — a one-shot task's final output is collected through the generic task surface, and a continuable child's output stays in its own session, read by its subagent id. The settlement notice states how that child ended and carries any final assistant message, but it is not this call's return value and cannot be awaited here.
- **Duplicate names across waiting one-shot instances are detected late** (`TODO(subagent-dup-toolname)`) — continuable instances reserve their prompt-section name during plugin application, but preventing provider-registration rollback for waiting one-shot instances requires a registry of intended names.
- **Child policy is fixed per instance** — another model, persona, tool filter, or depth cap requires another distinctly named tool.
