/** Deterministic seed/oracle projects used by the generic A/B evaluator. */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FixtureSpec } from './types.ts'

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/** The fixed fixture catalog shared by evaluation consumers. */
export const FIXTURES: readonly FixtureSpec[] = [
  {
    id: 'tiny-localized',
    suite: 'baseline',
    task: 'Fix greet() so it returns Hello, <name>!. Edit only src/greet.js.',
    root: join(fixturesRoot, 'tiny-localized'),
    validation: { command: process.execPath, args: ['test.js'] },
    units: [{ role: 'implementation', complexity: 'simple', risk: 'low', scopes: ['src/greet.js'] }],
  },
  {
    id: 'repetitive-mechanical',
    suite: 'baseline',
    task: 'Add return to add, sub, mul, div, and mod. Same mechanical edit five times.',
    root: join(fixturesRoot, 'repetitive-mechanical'),
    validation: { command: process.execPath, args: ['test.js'] },
    units: [{ role: 'implementation', complexity: 'simple', risk: 'low', repetitive: true, scopes: ['src/ops.js'] }],
  },
  {
    id: 'medium-implementation',
    suite: 'baseline',
    task: 'Implement the checked key-value store across store, validate, and index.',
    root: join(fixturesRoot, 'medium-implementation'),
    validation: { command: process.execPath, args: ['test.js'] },
    units: [{ role: 'implementation', complexity: 'ordinary', risk: 'medium', scopes: ['src/store.js', 'src/validate.js', 'src/index.js'] }],
  },
  {
    id: 'risky-cross-component',
    suite: 'baseline',
    task: 'Rename user.name to user.displayName across the shared contract and its readers/writers.',
    root: join(fixturesRoot, 'risky-cross-component'),
    validation: { command: process.execPath, args: ['test.js'] },
    units: [
      { role: 'implementation', complexity: 'ordinary', risk: 'high', scopes: ['src/contract.js', 'src/read.js', 'src/write.js', 'src/format.js'] },
      { role: 'review', complexity: 'complex', risk: 'high', exceptional: true, scopes: ['src'] },
    ],
  },
  {
    id: 'config-layering',
    suite: 'medium',
    task: 'Implement immutable layered configuration resolution. Merge plain objects recursively, replace arrays, ignore undefined overrides, validate the resolved runtime fields, and preserve every input object.',
    root: join(fixturesRoot, 'config-layering'),
    validation: { command: process.execPath, args: ['test.js'] },
    units: [{ role: 'implementation', complexity: 'ordinary', risk: 'medium', scopes: ['src/merge.js', 'src/validate.js', 'src/index.js'] }],
  },
  {
    id: 'retry-policy',
    suite: 'medium',
    task: 'Implement an asynchronous retry policy with injected delay, transient-error classification, abort support, deterministic exponential backoff, and no retry after a permanent failure.',
    root: join(fixturesRoot, 'retry-policy'),
    validation: { command: process.execPath, args: ['test.js'] },
    units: [{ role: 'implementation', complexity: 'ordinary', risk: 'medium', scopes: ['src/retry.js', 'src/errors.js'] }],
  },
  {
    id: 'event-projection',
    suite: 'medium',
    task: 'Implement an immutable session-event projector. Enforce sequence continuity, support create/rename/message/delete events, ignore only unknown ignorable events, and reject every other malformed transition.',
    root: join(fixturesRoot, 'event-projection'),
    validation: { command: process.execPath, args: ['test.js'] },
    units: [{ role: 'implementation', complexity: 'ordinary', risk: 'medium', scopes: ['src/project.js', 'src/reducer.js'] }],
  },
  {
    id: 'transactional-batch',
    suite: 'difficult',
    task: 'Complete the versioned key-value store batch API. A batch must validate before mutation, commit atomically against an expected version, publish one immutable change notification after commit, and leave state/version/subscribers untouched on every failure.',
    root: join(fixturesRoot, 'transactional-batch'),
    validation: { command: process.execPath, args: ['test.js'] },
    units: [
      { role: 'implementation', complexity: 'complex', risk: 'high', scopes: ['src/store.js', 'src/batch.js', 'src/errors.js'] },
      { role: 'validation', complexity: 'ordinary', risk: 'high', scopes: ['src'] },
    ],
  },
  {
    id: 'dependency-scheduler',
    suite: 'difficult',
    task: 'Implement the asynchronous dependency scheduler. Validate the entire DAG before execution, honor the concurrency limit, run ready tasks deterministically, block dependents after failure, wait for in-flight tasks, and return a complete status map.',
    root: join(fixturesRoot, 'dependency-scheduler'),
    validation: { command: process.execPath, args: ['test.js'] },
    units: [
      { role: 'implementation', complexity: 'complex', risk: 'high', scopes: ['src/graph.js', 'src/scheduler.js'] },
      { role: 'review', complexity: 'complex', risk: 'high', scopes: ['src'] },
    ],
  },
  {
    id: 'session-compaction',
    suite: 'difficult',
    task: 'Implement transcript compaction under a token budget. Preserve the system prefix, the latest user turn, assistant/tool-call/tool-result atomic groups, chronological order, and immutability; reject an impossible budget instead of emitting a broken transcript.',
    root: join(fixturesRoot, 'session-compaction'),
    validation: { command: process.execPath, args: ['test.js'] },
    units: [
      { role: 'inspection', complexity: 'ordinary', risk: 'high', scopes: ['src/groups.js'] },
      { role: 'implementation', complexity: 'complex', risk: 'high', scopes: ['src/compact.js', 'src/groups.js'] },
    ],
  },
  {
    id: 'plugin-lifecycle-stress',
    suite: 'stress',
    task: 'Repair the asynchronous plugin lifecycle manager. It must validate dependencies, activate concurrently requested plugins once, roll back a failed dependency chain in reverse activation order, keep unrelated active plugins alive, and make shutdown idempotent while reporting all teardown errors.',
    root: join(fixturesRoot, 'plugin-lifecycle-stress'),
    validation: { command: process.execPath, args: ['test.js'] },
    units: [
      { role: 'inspection', complexity: 'complex', risk: 'high', exceptional: true, scopes: ['src/graph.js', 'src/manager.js'] },
      { role: 'implementation', complexity: 'complex', risk: 'high', exceptional: true, scopes: ['src/graph.js', 'src/manager.js', 'src/errors.js'] },
      { role: 'review', complexity: 'complex', risk: 'high', exceptional: true, scopes: ['src'] },
    ],
  },
  {
    id: 'durable-workflow-recovery',
    suite: 'stress',
    task: 'Implement the durable workflow reducer and recovery planner. Replays must enforce monotonic event sequence, deduplicate command keys, recover expired leases, never re-run completed effects, schedule only dependency-ready steps, and produce deterministic commands after any crash point.',
    root: join(fixturesRoot, 'durable-workflow-recovery'),
    validation: { command: process.execPath, args: ['test.js'] },
    units: [
      { role: 'inspection', complexity: 'complex', risk: 'high', exceptional: true, scopes: ['src/events.js', 'src/reducer.js', 'src/recover.js'] },
      { role: 'implementation', complexity: 'complex', risk: 'high', exceptional: true, scopes: ['src'] },
      { role: 'validation', complexity: 'complex', risk: 'high', exceptional: true, scopes: ['src'] },
    ],
  },
  {
    id: 'multi-tenant-tool-runtime',
    suite: 'stress',
    task: 'Repair the multi-tenant tool runtime. Resolve session-scoped tools without cross-tenant cache leakage, enforce permissions before invocation, compose caller cancellation with timeouts, release each acquired resource exactly once, and emit immutable ordered audit records for every outcome.',
    root: join(fixturesRoot, 'multi-tenant-tool-runtime'),
    validation: { command: process.execPath, args: ['test.js'] },
    units: [
      { role: 'inspection', complexity: 'complex', risk: 'high', exceptional: true, scopes: ['src/registry.js', 'src/runtime.js', 'src/audit.js'] },
      { role: 'implementation', complexity: 'complex', risk: 'high', exceptional: true, scopes: ['src'] },
      { role: 'review', complexity: 'complex', risk: 'high', exceptional: true, scopes: ['src'] },
    ],
  },
]

export type { FixtureCategory, FixtureSpec, FixtureSuite, EvalWorkUnit } from './types.ts'
