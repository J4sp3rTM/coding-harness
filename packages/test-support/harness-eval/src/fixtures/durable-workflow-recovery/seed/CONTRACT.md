# Public contract

Export `replay(definitions, events)` from `src/reducer.js` and `planRecovery(definitions, state, now)` from `src/recover.js`. Definitions are `{ id, deps }`. Every event has consecutive one-based `sequence`, `type`, `stepId`, and non-empty `commandKey`.

Supported types are `step-leased` with `leaseId` and `expiresAt`, `effect-completed` with `effectId`, `step-completed`, and `step-failed`. Duplicate command keys advance sequence but do not apply twice. State is `{ sequence, steps: Map, commandKeys: Set }`; each step tracks `status`, `lease`, and `effects: Set`.

Recovery returns deterministic commands in definition order. An expired running step yields `{ type: 'resume', stepId, leaseId, commandKey: 'resume:<stepId>:<leaseId>', completedEffects }`. A pending step whose dependencies completed yields `{ type: 'start', stepId, commandKey: 'start:<stepId>', completedEffects: [] }`. Never emit a command key already recorded.
