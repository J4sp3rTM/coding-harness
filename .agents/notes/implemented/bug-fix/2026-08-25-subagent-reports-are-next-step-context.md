# Agent Note: Child-to-parent mail is next-step context, not a queued prompt

Status: implemented

English | [中文](2026-08-25-subagent-reports-are-next-step-context.zh.md)

## Problem

A continuable child's `report` and the runtime settlement notice are model-facing context. After claim they already render as context-injection rows. The default waking path still used `Agent.followup()`, which puts the same message in `next-turn`. The Web queue dock treats every next-turn item as a user prompt, so a report or settlement appeared as an editable, removable, steerable queued message until the parent claimed it.

`inject()` alone does not fix that for a parked parent. An idle `inject()` stages next-step context and does not start a turn, so a coordinator that launched background children and went idle would never read the mail.

## Decision

Child-to-parent reports and settlement notices use next-step delivery, never `followup()`.

Waking delivery on an idle parent calls `parent.steer()`. The message is next-step context. The Host queue snapshot therefore gives it `placement: 'context'`, so QueueDock hides it and ChatView does not draw a steering bubble. After claim it still renders as a context-injection row. `steer()` starts a turn, which is the wake a parked coordinator needs.

A running parent, including one whose turn is already aborted, gets `parent.inject()` instead. `Agent.send()` reclassifies every waking send onto `next-turn` while an abort is still draining, and that is exactly the dock FIFO this change forbids. The live driver claims next-step itself; a parent the user just Stop'd keeps the notice for the next prompt instead of restarting.

Quiet reports and teardown settlement still call `parent.inject()`. Parent-to-child `followup()` is unchanged: that direction remains a later child turn.

The [report tool](../feature/2026-07-30-continuable-subagent-report-tool.md), [report obligation](../feature/2026-08-06-continuable-child-report-obligation.md), and [settlement delivery](../feature/2026-08-06-manager-owned-subagent-settlement-delivery.md) notes keep the rest of those decisions and now describe this send path.

## Alternatives considered

**Keep `followup()` and hide non-user next-turn items in the queue projector.** The dock would stop showing reports, but they would still occupy the user's later-turn FIFO and remain editable through queue RPCs. The defect is the send target, not only the projection.

**Switch waking delivery to `inject()`.** That matches "context only" in the inbox, and it leaves a parked parent silent. `steer()` is the existing send that is both next-step and waking.

**Change `inject()` so idle context wakes the driver.** Every other inject caller — hooks, workspace instructions, time context — would start unsolicited turns. The idle-inject contract is that context waits.

## Consequences

- A report or settlement never appears in the Web queue dock. The parent still continues when a child reports or settles.
- Several children reporting or settling while the parent is already running share one next-step claim.
- Package tests pin wakeup reports in `next-step` and still require a parent model request. Settlement's idle-parent turn and busy-parent batch tests keep their observations; the rejected-send test spies on `steer`. A wakeup report and a settlement notice sent while the parent turn is aborting stay in `next-step` with an empty `next-turn`.
