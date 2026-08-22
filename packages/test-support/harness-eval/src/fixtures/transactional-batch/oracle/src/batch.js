function applyBatch(source, operations) {
  if (!Array.isArray(operations) || operations.length === 0) throw new TypeError('operations must be a non-empty array')
  for (const operation of operations) {
    if (operation === null || typeof operation !== 'object' || !['set', 'delete'].includes(operation.type)) throw new TypeError('invalid operation')
    if (typeof operation.key !== 'string' || operation.key.length === 0) throw new TypeError('operation key must be non-empty')
    if (operation.type === 'set' && !Object.hasOwn(operation, 'value')) throw new TypeError('set operation requires value')
  }
  const next = new Map(source)
  for (const operation of operations) {
    if (operation.type === 'set') next.set(operation.key, operation.value)
    else next.delete(operation.key)
  }
  return next
}

module.exports = { applyBatch }
