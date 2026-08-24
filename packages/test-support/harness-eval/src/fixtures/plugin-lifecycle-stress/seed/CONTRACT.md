# Public contract

Export `createPluginManager(plugins)` from `src/manager.js`. Each plugin is `{ id, deps, start }`; `start()` returns an asynchronous stop function. Validate duplicate IDs, missing dependencies, and cycles synchronously during manager creation.

The manager exposes `activate(id)`, `activeIds()`, and `shutdown()`. Activation starts dependencies first. Concurrent activation of the same plugin shares one start. If activation fails, stop only plugins newly activated by that request in reverse order; unrelated previously active plugins remain active.

`activeIds()` returns active IDs in activation order. Shutdown stops all active plugins in reverse order, clears state before awaiting stops, is idempotent, attempts every stop, and throws one `AggregateError` containing all stop failures.
