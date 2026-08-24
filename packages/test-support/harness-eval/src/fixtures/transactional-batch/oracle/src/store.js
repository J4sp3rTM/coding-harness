const { applyBatch } = require('./batch')
const { VersionConflictError } = require('./errors')

function frozenChange(change) {
  Object.freeze(change.before)
  Object.freeze(change.after)
  Object.freeze(change.keys)
  return Object.freeze(change)
}

function createStore(initial = {}) {
  let values = new Map(Object.entries(initial))
  let version = 0
  const subscribers = new Set()
  return {
    get version() { return version },
    snapshot: () => Object.fromEntries(values),
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener) },
    batch(expectedVersion, operations) {
      if (expectedVersion !== version) throw new VersionConflictError(`expected version ${expectedVersion}, found ${version}`)
      const before = Object.fromEntries(values)
      const next = applyBatch(values, operations)
      const after = Object.fromEntries(next)
      const keys = [...new Set(operations.map(operation => operation.key))]
      values = next
      version += 1
      const change = frozenChange({ version, before, after, keys })
      for (const listener of [...subscribers]) listener(change)
      return { ...after }
    },
  }
}

module.exports = { createStore }
