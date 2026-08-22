const assert = require('node:assert/strict')
const { resolveConfig } = require('./src')

const defaults = { port: 3000, endpoint: 'local', nested: { retries: 2, flags: { trace: false } }, tags: ['base'] }
const user = { port: 4100, nested: { flags: { trace: true } }, tags: ['user'] }
const session = { endpoint: undefined, nested: { retries: 5 } }
const snapshots = JSON.stringify([defaults, user, session])
const result = resolveConfig(defaults, user, session)
assert.deepEqual(result, { port: 4100, endpoint: 'local', nested: { retries: 5, flags: { trace: true } }, tags: ['user'] })
assert.equal(JSON.stringify([defaults, user, session]), snapshots)
result.nested.flags.trace = false
assert.equal(user.nested.flags.trace, true)
assert.throws(() => resolveConfig(defaults, { port: 0 }), /port/)
assert.throws(() => resolveConfig(defaults, { endpoint: 42 }), /endpoint/)
console.log('config-layering: PASS')
