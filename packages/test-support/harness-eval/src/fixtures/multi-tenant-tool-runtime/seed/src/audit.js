function createAuditLog() {
  return { append: () => {}, entries: () => [] }
}

module.exports = { createAuditLog }
