# @deepseek-ai/dsh-goal-round-driver

English | [中文](README.zh.md)

Same-session continuation driver for [`ctx.goals`](../goal/README.md). It turns an active, armed goal into sequential [goal rounds](../../../docs/glossary.md#goal-round) through the public `Agent` and session services; the [same-session driver Agent Note](../../../.agents/notes/implemented/feature/2026-07-19-same-session-goal-round-driver.md) owns the race and lifecycle rationale.

## Composition

```yaml
- id: goal
  name: '@deepseek-ai/dsh-goal'

- id: llm-retry
  name: '@deepseek-ai/dsh-llm-retry'

- id: tool-goal
  name: '@deepseek-ai/dsh-tool-goal'

- id: goal-round-driver
  name: '@deepseek-ai/dsh-goal-round-driver'
  config:
    transientRetry:
      retryableCodes: [EMPTY_RESPONSE, PI_AI_ERROR, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT]
```

`maxGoalRounds` belongs to the goal definition, while the model-facing blocked threshold belongs to [`dsh-tool-goal`](../tool-goal/README.md); duplicating either value in the driver could produce divergent policy. `transientRetry` registers a goal-scoped contribution with [`dsh-llm-retry`](../../llm/llm-retry/README.md), which remains the sole owner of backoff, retry numbering, durable events, and teardown drain. The retryable-code list defaults to `EMPTY_RESPONSE`, `PI_AI_ERROR`, `RATE_LIMIT`, `SERVER`, `TIMEOUT`, and `TRANSPORT`. Backoff defaults to 500 ms initially, 10 seconds maximum, and 10 percent jitter. A valid provider `Retry-After` at or below the maximum is used verbatim; an over-cap value uses local backoff because the goal fallback is unbounded. Permanent classes such as `AUTH`, `QUOTA`, `INVALID_REQUEST`, and `CONTEXT_WINDOW_EXCEEDED` are not retried unless explicitly added.

## Round contract

When an exact live agent is idle with an active, armed goal and remaining capacity, the driver first checkpoints pending goal mutations, then reserves `roundsStarted + 1` for the current `{ goalId, revision }`. It queues one `<goal_round>` prompt with `GoalMessageSource`. The `agent/pre-step` listener verifies the complete claimed record and current goal both before and after downstream listeners; only an entered `user/message` increments `roundsStarted`. A reservation rejected as stale does not consume the round number.

`MessageId` identifies the reserved message through durable inbox insertion and claim; it does not identify a turn result. Human messages do not consume the goal cap. If human work enters the inbox before a reservation or joins its pending batch, automatic work yields until the agent becomes idle; a pending automatic prompt in a mixed batch is rejected and re-reserved only after that checkpoint.

The retained prompt names the JSON-quoted objective and `round/maxGoalRounds`, treats the current workspace, tool results, and durable session state as authoritative, requires evidence before completion, and tells the model to leave the goal active when work remains. Quoting preserves multiline or tag-like objective text as data. Goal lifecycle mutations still require the independent authority checks in `dsh-tool-goal`.

## Idle checkpoint

At whole-agent idle, durable goal phase and revision are authoritative. An active, armed goal with capacity reserves its next round; completion, pause, blocking, and edits suppress continuation. A finite provider policy spends its own retry budget first; after provider and downstream recovery decline, the configured goal contribution retries the same request step without consuming another goal round. A provider `always` policy remains the only retry owner. Permanent provider errors and token limits remain terminal goal outcomes.

## Lifecycle and durability

`goal/changed` creates a durability obligation. Before queuing work, the driver awaits `ctx.sessions.flush()` and rechecks both the goal revision and competing input after the await. A flush failure arriving through `agent/error` disarms continuation before another round can start.

Activation is never inherited when this plugin loads over an existing agent. `GoalService.disarm()` removes process-local authority without changing durable phase, revision, or history; explicit human-authorized resume records the later reactivation. The same rule applies after session resume and fork through the goal domain's `agent/session-start` handling.

Cancellation removes pending inbox work or leaves an agent-wide aborted state. At the next idle checkpoint the driver pauses a goal with a reserved or admitted attempt so cancellation cannot auto-restart it; cancellation unrelated to a goal attempt only disarms process-local continuation. Goal mutation, competing inbox input, session restart, and plugin teardown abort the contribution signal, including a provider-owned backoff that precedes the goal fallback. If a pause mutation fails, the driver falls back to disarming. Plugin teardown closes admission, disarms every live goal, cancels active work with the `parent` cause, and awaits the driver plus agent quiescence while its event fence remains installed.

## Model Experience

### Goal-round prompt

#### What the model sees

Each admitted round is one retained user-role `<goal_round>` block naming the full objective and positive round number. Earlier human messages, goal-state snapshots, assistant output, and tool records remain in the same session history.

#### Token effect

One fixed instruction block plus the objective is added per admitted round. Later requests, including each recovery attempt, resend retained rounds until compaction shadows them; no fresh agent or copied conversation prefix is created. The fallback has no request limit while the exact goal round remains admitted, so a continuing outage can repeat input-token billing until cancellation, a goal mutation, competing work, or plugin teardown.

#### KV Cache effect

Append-only within an epoch: each admitted round extends the existing conversation after its reusable prefix. Compaction may replace the derived-history suffix and move the reusable boundary.

## Known Limitations and Deferred Work

- **No independent evaluator** — the model-facing goal policy decides when evidence is sufficient for completion and whether a blocker is semantically unchanged; evaluator-backed certification remains deferred.
- **Same-session execution only** — this package deliberately does not spawn a fresh agent, fork a session prefix, or implement Ralph-style independent attempts; that workflow belongs to its own plugin layer.
- **Accepted-queue unload race** — Cordis plugin unload is asynchronous. A goal prompt already accepted by the agent inbox can begin and consume its round before unload starts; teardown then cancels the request, disarms the goal, and awaits quiescence. No later round starts.
- **Round cap, not resource budget** — token, currency, time, and provider quota policies remain independent. Their session events are not attributed to the goal message or mapped into goal blocker codes.
- **Transient fallback is unbounded** — eligible failures keep polling within the same admitted round and do not spend `maxGoalRounds`; deployments that need a monetary or wall-time ceiling must supply an independent cancellation policy.
- **Persistence failures remain terminal** — retry recovery covers normalized model-request failures only; a checkpoint failure disarms continuation and requires a later human-authorized resume.
