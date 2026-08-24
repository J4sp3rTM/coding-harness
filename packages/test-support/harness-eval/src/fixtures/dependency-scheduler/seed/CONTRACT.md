# Public contract

Export asynchronous `runScheduler(tasks, { concurrency })` from `src/scheduler.js`. Each task is `{ id, deps, run }`; `deps` contains task IDs and `run()` returns a value or promise.

Validate duplicate IDs, missing dependencies, cycles, and a positive integer concurrency before running anything. Start ready tasks in input order up to the limit. Return `Map<id, status>` after all runnable work settles.

Successful status is `{ status: 'fulfilled', value }`, failure is `{ status: 'rejected', reason }`, and a task depending directly on a rejected or blocked task becomes `{ status: 'blocked', dependencies }`. `dependencies` lists the failed/blocked direct dependencies in declared order. Unrelated branches continue after a failure.
