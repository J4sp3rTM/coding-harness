# Delegator steering: findings summary

Status: analysis only — nothing here is implemented, and the design needs product decisions before it can be built.

## Problem

An operator message sent while `delegate_work` or `workflow` is in flight produces no reaction until the run finishes.

## Root cause

The input is neither lost nor mis-routed. `Agent.steer` inserts it at the `next-step` inbox target and the insertion is durable, but the loop reads the claimed batch only at a step boundary (`packages/core/agent-loop/src/agent.ts`, `preStep`). A foreground delegator call occupies everything between two boundaries: `executeToolCalls` awaits every dispatch before returning (`packages/core/agent-loop/src/tool-calls.ts`), and both delegation tools await the whole run inside their tool body (`packages/workflow/tool-workflow/src/index.ts`, `packages/workflow/tool-development-workflow/src/index.ts`). A wake during a running phase latches nothing.

Cancellation is the only external input that lands mid-run, because it aborts the activity signal both tools bridge to `run.cancel()`. It answers "stop" but cannot answer "redirect": a cancelled run discards partial output.

Two further constraints bound any fix. The host→worker protocol carries only the startup gate, cancel, and child-RPC replies, so there is no inbound port for steering. The script has no await point external input could resolve — its globals are exactly `agent`, `parallel`, `pipeline`, `phase`, `log`, and `args`. Workflow children are one-shot runs, so `send_message` and `interrupt_agent` cannot reach them; `interrupt_agent` silently reports `{ accepted: true }` while doing nothing, which is worth fixing on its own.

## Recommended direction

A script-side steering mailbox: a new host→worker protocol tag, a bounded worker-side mailbox, and a `steering()` hook the script awaits between stages. The workflow consumers forward user-origin inbox insertions into the run while leaving the message in the parent inbox for its normal step-boundary claim. This stays on the workflow seam's Service Definition, provider, and consumers, and touches no core loop code.

Rejected: checkpoint/resume of a running script (vm heap is unserializable, and the closed `WorkflowStopReason` union plus both consumers would have to grow a suspended variant), and registering workflow children as continuable agents (breaks one-shot lifetime, `callId`-keyed isolation, and the script's result funnel).

## Open product decisions

- Should forwarded steering be consuming (removed from the parent inbox) or non-consuming (the parent also sees it at the next boundary)?
- Mailbox policy when a script never drains: reject delivery or drop oldest under a configured bound?
- Should `delegate_work` apply steering autonomously or only surface it in reports?
- Should `workflow/log` and `workflow/phase` become durable session events?

## Adjacent finding: subagent todo visibility

The one-shot read-only composer record is correct behavior, and the child-session todo data plane is wired end to end. "Subagent todos are not visible" resolves to two separate causes: the `todos` projection fold clears on every `turn/start`, so a child that writes a list in one turn and enters any later turn without rewriting it hides the list permanently; and no parent-side rollup of child work-unit progress exists at all. The second is the observability half of steering and pairs naturally with the mailbox work.
