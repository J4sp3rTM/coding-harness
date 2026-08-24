function createPluginManager() {
  return { activate: async () => {}, shutdown: async () => {}, activeIds: () => [] }
}

module.exports = { createPluginManager }
