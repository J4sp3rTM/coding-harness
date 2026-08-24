const assert = require('node:assert/strict')
const { compactTranscript } = require('./src/compact')

const messages = [
  { id: 's', role: 'system', tokens: 2 },
  { id: 'u1', role: 'user', tokens: 3 },
  { id: 'a1', role: 'assistant', tokens: 3 },
  { id: 'u2', role: 'user', tokens: 2 },
  { id: 'call', role: 'assistant', tokens: 2, toolCalls: ['c1'] },
  { id: 'result', role: 'tool', tokens: 4, callId: 'c1' },
  { id: 'a2', role: 'assistant', tokens: 2 },
]
const snapshot = JSON.stringify(messages)
assert.deepEqual(compactTranscript(messages, 12).map(item => item.id), ['s', 'u2', 'call', 'result', 'a2'])
assert.equal(JSON.stringify(messages), snapshot)
assert.deepEqual(compactTranscript(messages, 6).map(item => item.id), ['s', 'u2', 'a2'])
assert.throws(() => compactTranscript(messages, 3), /budget/)
assert.throws(() => compactTranscript([{ id: 'x', role: 'tool', tokens: 1, callId: 'missing' }], 10), /tool/)
console.log('session-compaction: PASS')
