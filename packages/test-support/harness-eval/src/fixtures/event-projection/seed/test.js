const assert = require('node:assert/strict')
const { projectSession } = require('./src/project')

const events = [
  { sequence: 1, type: 'created', id: 's1', title: 'Draft' },
  { sequence: 2, type: 'message', role: 'user', text: 'hello' },
  { sequence: 3, type: 'future-event', ignorable: true, payload: { mutable: true } },
  { sequence: 4, type: 'renamed', title: 'Final' },
]
const snapshot = JSON.stringify(events)
const state = projectSession(events)
assert.deepEqual(state, { id: 's1', title: 'Final', messages: [{ role: 'user', text: 'hello' }], deleted: false, sequence: 4 })
assert.equal(JSON.stringify(events), snapshot)
state.messages[0].text = 'changed'
assert.equal(events[1].text, 'hello')
assert.throws(() => projectSession([{ sequence: 2, type: 'created', id: 'x', title: 'x' }]), /sequence/)
assert.throws(() => projectSession([{ sequence: 1, type: 'created', id: 'x', title: 'x' }, { sequence: 2, type: 'unknown' }]), /unknown/)
assert.throws(() => projectSession([{ sequence: 1, type: 'message', role: 'user', text: 'early' }]), /created/)
assert.deepEqual(projectSession([...events, { sequence: 5, type: 'deleted' }]).deleted, true)
console.log('event-projection: PASS')
