# Agent Note: Mid-run steering for delegated workflows

Status: implemented

English | [中文](2026-08-25-delegator-steering-mailbox.zh.md)

## Problem

A message the user sends while `delegate_work` or `workflow` is in flight produced no reaction until the run finished. The input was neither lost nor mis-routed: `Agent.steer` inserts it at the `next-step` inbox target and the insertion is durable, but the loop reads a claimed batch only at a step boundary, and a foreground delegation occupies everything between two boundaries — `executeToolCalls` awaits every dispatch, and both delegation tools await the whole run inside their tool body. Waking a driver that is already running latches nothing.

Cancellation was the only external input that landed mid-run, because it aborts the activity signal both tools bridge to `run.cancel()`. It answers "stop" but cannot answer "redirect": a cancelled run discards partial output. The user's practical experience was that steering a working agent silently did nothing.

## Decision

Operator input reaches a running script through a host→worker steering mailbox, and the parent's claim of that same message is untouched.

`WorkflowRun.steer(text)` is part of the seam. The worker-thread engine posts the new `steer` protocol message; the worker-side execution appends it to a per-run mailbox that the script drains through the `steering()` hook, which resolves with the messages received since the previous call and never waits for one to arrive. `steer()` returns whether the run accepted the message for worker delivery. A run that is cancelled, settled, or whose worker is gone drops the message, as does a cancelled worker-side execution.

Forwarding is **non-consuming**. `forwardSteering` (in `@deepseek-ai/dsh-tool-workflow/steering`, used by both delegation tools) listens to `agent/inbox/inserted` for the calling agent while the run lives and forwards only `source.kind === 'user'` insertions; the message stays in the parent's inbox and is claimed at the parent's ordinary next step boundary. An accepted forward also appends durable `tool-workflow/steering` receipt metadata without copying message content. The receipt says that the run accepted the message, not that a worker acted on it; the transcript remains identical whether or not a script drained the copy. See the [workflow steering receipt note](2026-08-26-workflow-run-steering-record.md).

The mailbox is bounded by the engine's `maxSteeringMessages` (default 16). At the bound the oldest undrained message is dropped and the drop is narrated through `log`, so a script that never drains cannot grow memory without bound and the loss is still visible.

`delegate_work` consumes steering autonomously: its fixed script drains before each remaining unit and prefixes drained guidance to later worker prompts as instructions that outrank the plan where they conflict. Its result carries `steering.applied` and `steering.unapplied`, and the rendered text names both, so the parent neither repeats guidance the workers already received nor silently drops guidance that arrived too late for any worker. Generic `workflow` scripts opt in by calling `steering()` themselves.

## Alternatives considered

**Consuming forwarding (remove the message from the parent's inbox).** The script would own the message outright, avoiding the parent reading guidance the workers already applied. It was rejected because the forwarded copy would then be the only path a durable user message travels, which requires a new session event to keep "model-visible ⟺ logged" true and makes a dropped delivery lose real user input. Naming applied guidance in the result solves the duplication concern without touching the log.

**Checkpoint and resume the running script.** Suspending on steering and resuming with new instructions would let arbitrary scripts react at any point. The vm heap is not serializable, and the closed `WorkflowStopReason` union plus both consumers would have to grow a suspended variant.

**Register workflow children as continuable agents so `send_message` reaches them.** This would reuse the existing continuation machinery instead of adding a protocol message, but it breaks the one-shot child lifetime, the `callId`-keyed isolation the child RPC depends on, and the script's result funnel.

**Report steering only in the tool result, without a worker-side mailbox.** Cheap and log-safe, but it delivers nothing until the run ends — the exact failure being fixed.

**Block or poll on `steering()` until a message arrives.** An awaiting hook reads naturally between stages, but a script polling an empty mailbox would park a run that has no other work, and the hook would become a second way to wedge a workflow. Resolving immediately keeps the drain a pure read.

## Testing

- `session.spec.ts` drives the real worker session over a MessageChannel: arrival-order drain, the empty second drain, drop-oldest at the bound with its narration, and a cancelled run dropping later steering while `steering()` throws `CANCELLED` like every other hook.
- `workflow-worker-thread.spec.ts` covers the host across a real worker thread: `steer()` reaching a running script, and steering a settled or cancelled run being dropped rather than an error.
- Both delegation consumers cover forwarding, the source filter, the empty-text skip, another agent's insertions, and listener disposal at settlement.
- `tool-development-workflow/tests/integration.spec.ts` composes the real engine, the real subagent provider, and the real parent inbox: a message injected as unit 1 starts is absent from the first worker's prompt, present in the second's, and reported as `applied`.

## Consequences

- A user can redirect delegated work without cancelling it and losing partial output; guidance reaches only units that have not started.
- A unit already in flight cannot be redirected, and under `parallel: true` only the drain before the batch applies. The result says so explicitly instead of implying the guidance landed.
- The parent may read guidance the workers already applied; the result names it as applied so the parent does not reissue it.
- Every `WorkflowRun` implementation, including test fakes, must supply `steer`.
- `delegate_work` results now require a `steering` record; a script return without one is rejected as malformed, the same discipline the `objective`/`reports` fields already had.
- One-shot workflow children remain unreachable by `send_message` and `interrupt_agent`; `interrupt_agent` still reports `{ accepted: true }` for an absent target, which its own service contract documents as a uniform no-op. Changing that is a separate decision about the subagent seam, not about steering.
