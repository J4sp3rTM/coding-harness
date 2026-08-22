function createRegistry(resolver) {
  const cache = new Map()
  return {
    async resolve(scope) {
      const key = JSON.stringify([scope.tenantId, scope.sessionId, scope.name])
      let tool = cache.get(key)
      if (tool === undefined) { tool = await resolver(scope); cache.set(key, tool) }
      return tool
    },
  }
}

module.exports = { createRegistry }
