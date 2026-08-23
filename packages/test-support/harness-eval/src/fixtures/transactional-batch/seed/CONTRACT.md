# Public contract

Export `createStore(initial?)` from `src/store.js` and `VersionConflictError` from `src/errors.js`. A store exposes numeric getter `version`, `snapshot()`, `subscribe(listener)`, and `batch(expectedVersion, operations)`.

Operations are `{ type: 'set', key, value }` or `{ type: 'delete', key }`. `batch` validates every operation before mutation, rejects a stale version with `VersionConflictError`, increments the version once, and returns the committed snapshot.

After a commit, each subscriber receives one frozen `{ version, before, after, keys }` record. `keys` contains changed keys once in operation order. `subscribe` returns an unsubscribe function. No failure may change state, version, or notifications.
