const assert = require('node:assert/strict')
const { replay } = require('./src/reducer')
const { planRecovery } = require('./src/recover')

const steps = [{ id: 'fetch', deps: [] }, { id: 'transform', deps: ['fetch'] }, { id: 'publish', deps: ['transform'] }]
const events = [
  { sequence: 1, type: 'step-leased', stepId: 'fetch', leaseId: 'l1', expiresAt: 10, commandKey: 'start:fetch' },
  { sequence: 2, type: 'effect-completed', stepId: 'fetch', effectId: 'download', commandKey: 'effect:download' },
  { sequence: 3, type: 'step-completed', stepId: 'fetch', commandKey: 'finish:fetch' },
  { sequence: 4, type: 'step-leased', stepId: 'transform', leaseId: 'l2', expiresAt: 20, commandKey: 'start:transform' },
  { sequence: 5, type: 'effect-completed', stepId: 'transform', effectId: 'parse', commandKey: 'effect:parse' },
  { sequence: 6, type: 'effect-completed', stepId: 'transform', effectId: 'parse', commandKey: 'effect:parse' },
]
const state = replay(steps, events)
assert.equal(state.sequence, 6)
assert.deepEqual([...state.steps.get('transform').effects], ['parse'])
assert.deepEqual(planRecovery(steps, state, 15), [])
assert.deepEqual(planRecovery(steps, state, 25), [{ type: 'resume', stepId: 'transform', leaseId: 'l2', commandKey: 'resume:transform:l2', completedEffects: ['parse'] }])
const completed = replay(steps, [...events, { sequence: 7, type: 'step-completed', stepId: 'transform', commandKey: 'finish:transform' }])
assert.deepEqual(planRecovery(steps, completed, 25), [{ type: 'start', stepId: 'publish', commandKey: 'start:publish', completedEffects: [] }])
assert.throws(() => replay(steps, [events[0], { ...events[1], sequence: 3 }]), /sequence/)
assert.throws(() => replay(steps, [{ sequence: 1, type: 'step-completed', stepId: 'missing', commandKey: 'x' }]), /unknown step/)
console.log('durable-workflow-recovery: PASS')
