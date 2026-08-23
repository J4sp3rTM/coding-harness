# Public contract

Export `createAuditLog()` from `src/audit.js`, `createRegistry(resolver)` from `src/registry.js`, and `createToolRuntime({ registry, audit, authorize })` from `src/runtime.js`.

`runtime.invoke(request, options?)` receives `{ tenantId, sessionId, tool, args }`; options are `{ signal, timeoutMs }`. Call `authorize(request)` before resolving or acquiring. Registry resolution receives `{ tenantId, sessionId, name: request.tool }` and may cache only by all three fields. A resolved tool exposes asynchronous `acquire()`, returning `{ run(args, signal), release() }`.

Compose caller cancellation with timeout cancellation. Release every acquired resource exactly once in all outcomes. Audit records are frozen and contain increasing `sequence`, tenant/session/tool, and outcome: `completed`, `denied`, `timed-out`, `cancelled`, or `failed`. `audit.entries()` returns records in invocation completion order without exposing its mutable storage.
