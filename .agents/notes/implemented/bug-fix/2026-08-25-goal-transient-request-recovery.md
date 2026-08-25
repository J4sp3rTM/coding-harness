# Agent Note: Goal-round transient request recovery

English | [中文](2026-08-25-goal-transient-request-recovery.zh.md)

Status: implemented

## Problem

The goal-round driver disarmed an active goal whenever a model request reached `agent/error`. Adopted pi-ai routes can report recoverable `PI_AI_ERROR` failures without a provider retry policy, so an active goal stopped after one failed request and required a human wakeup.

## Decision

`dsh-llm-retry` exposes a process-local contribution registry while remaining the sole `agent/request-error` listener and executor. The goal-round driver registers one contribution only for the exact admitted goal revision. A finite provider policy spends its budget first; downstream recovery runs next; the goal fallback then handles configured transient failures, keeps the admitted goal message, and repeats the same model step without consuming another goal round. A provider `always` policy remains the only retry owner.

The retry service records `llm/retry` and `llm/retry-started` session facts for both provider and contributed policies. Contributor ids are part of durable policy keys, so provider rerouting and contribution changes start independent retry chains. The goal fallback uses the shared retry-policy resolver for exponential backoff, provider retry-after caps, and jitter, and defaults to transient provider classes. Authentication, quota, invalid-request, and context-overflow failures remain terminal unless explicitly added to the configuration.

The request signal, retry-service lifetime, and goal contribution signal cancel the wait. A competing inbox message, goal phase or revision change, session restart, cancellation, and teardown prevent the next attempt, including during a provider-owned backoff. Teardown removes the contribution, cancels active goal work, and lets the retry service drain its owned wait before releasing the agent.

## Consequences

Transient model failures no longer consume goal rounds or require a human wakeup. The provider retry layer and goal fallback can both appear in one request, but distinct policy keys and retry identities keep their durable histories separate. The goal fallback is unbounded while the exact round remains admitted, so cancellation is the independent cost and wall-time control. Persistence failures and terminal model failures still disarm continuation.

## Testing

The real AgentLoop regressions cover PI_AI_ERROR recovery without a human wakeup, provider-first 429 recovery, provider `always` ownership, goal and steering cancellation during provider or fallback backoff, provider rerouting-safe policy chains, disposal, and terminal AUTH/request/max-token outcomes. A real Loader composition and a keyless assembled headless snapshot cover the shipping plugin graph and durable retry transcript. Package invariants bind the contributed policy key to an admitted current goal round.

## Alternatives considered

Advancing directly to a new goal round after `agent/error` was rejected because it spends the goal budget and can hammer a rate-limited provider. A second `agent/request-error` executor inside the goal package was rejected because it duplicated backoff, event, chain, and teardown ownership and conflicted with provider `always` mode. Changing `agent-loop` was rejected because its existing recovery extension point is sufficient.
