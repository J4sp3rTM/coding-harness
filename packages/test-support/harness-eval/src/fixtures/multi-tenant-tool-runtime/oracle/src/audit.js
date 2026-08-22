function createAuditLog() {
  const records = []
  return {
    append(record) { records.push(Object.freeze({ sequence: records.length + 1, ...record })) },
    entries() { return [...records] },
  }
}

module.exports = { createAuditLog }
