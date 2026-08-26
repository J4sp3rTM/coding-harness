# Agent Note: A workflow run records the mid-run messages it received

Status: implemented

English | [中文](2026-08-26-workflow-run-steering-record.zh.md)

## Problem

Mid-run steering into `delegate_work` and `workflow` works — the message reaches every worker that has not started — but nothing in the GUI says so while the run is still going. The parent is blocked inside the tool call, so it cannot answer; the user's bubble sits in the transcript with no indication that anything received it; and the only acknowledgement, the tool result naming applied and unapplied guidance, arrives when the run ends. A user who steers a long delegation cannot tell the difference between "delivered to the remaining workers" and "ignored" until it is too late to act on either.

## Decision

A run states what it received. Each accepted forward appends `tool-workflow/steering` to the parent Session, carrying only the receiving `runId`. The `ui-workflow-run` panel counts those records per run and renders one tertiary line above the phase list — absent at zero — saying how many of the user's messages that run received.

The record carries no message content. The message text already exists in its own `user/message`; duplicating it would put the same words in the log twice and force the panel to re-render content the transcript owns. Correlating a specific record to a specific message is not needed for a count, so the payload stays minimal.

Only a run with an open durable record produces one, which follows the recorder's existing policy: nested transport calls write no workflow record at all, and a record already disabled by an append failure stays disabled and takes the steering record down with it.

The count answers "did this run receive my message", not "did a worker act on it". A message that arrives after every unit has started reaches no worker; the `delegate_work` result separates `applied` from `unapplied`, and the panel deliberately does not restate that distinction.

This adds no chrome to the message bubble itself. The [removed interjection caption](../simplification/2026-08-10-web-remove-steering-interjection-caption.md) decided that a steering bubble is recognizable by its position and needs no label; that decision stands. This note places the acknowledgement on the run that received the message, which is a different subject: a fact about the run's input, not a description of the bubble.

## Alternatives considered

**Caption the pending steering bubble as delivered.** The most direct feedback — it appears exactly where the user typed. It reintroduces the chrome the interjection-caption note removed, and it would have to promise something the bubble cannot know: one message may reach several runs, or none.

**Emit `workflow/log` and render it.** The live workflow narration channel already exists, so this looked free. Those events are not durable, so the acknowledgement would vanish on reload and be absent from replay, and the run panel is built strictly from durable records.

**Carry the message id or its text in the record.** An id enables per-message correlation and text enables rendering the message inside the run card. Neither is needed for the decided display, both widen a durable format that has no compatibility promise to weaken later, and the text form would duplicate `user/message` content in the log.

**Show nothing and rely on the tool result.** The model already gets the complete account when the run ends, and this costs no new event. It leaves the human without an answer during precisely the window where the answer changes their behavior — whether to wait, restate, or cancel.

## Testing

- `tool-workflow` package tests cover the durable record for each forwarded message, a steering append failure disabling the record while the run continues, and a later forward finding no active record.
- The package invariant rejects steering for an unknown run and after `tool-workflow/run-end`, and accepts it while the run is open.
- `ui-workflow-run` client tests cover the fold (two records on one run become a count of two) and the panel (absent at zero, singular at one, plural above one).
- `pnpm run test:gui` covers the assembled client lane; both changed packages hold per-file 100% coverage.

## Consequences

- A session log written by this build contains `tool-workflow/steering`, which an older build refuses on read like every other event outside its known vocabulary. The pre-release stance accepts that; `SESSION_FORMAT_VERSION` does not move because no structural rule changed.
- The panel gains one line and no control: the count is not clickable and does not name the messages.
- A consumer that forwards steering without owning a durable record (a nested call) shows nothing, matching the rest of that call's invisible record.
