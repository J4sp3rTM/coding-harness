const { validatePlugins } = require('./graph')

function createPluginManager(plugins) {
  const byId = validatePlugins(plugins)
  const active = new Map()
  const pending = new Map()
  let activationOrder = 0

  const activateOne = async (id, owned) => {
    if (active.has(id)) return
    const existing = pending.get(id)
    if (existing) return existing
    const promise = (async () => {
      const plugin = byId.get(id)
      if (!plugin) throw new Error(`missing plugin ${id}`)
      for (const dependency of plugin.deps) await activateOne(dependency, owned)
      if (active.has(id)) return
      const stop = await plugin.start()
      active.set(id, { stop, order: activationOrder++ })
      owned.push(id)
    })()
    pending.set(id, promise)
    try { await promise } finally { pending.delete(id) }
  }

  return {
    async activate(id) {
      const owned = []
      try { await activateOne(id, owned) } catch (error) {
        for (const pluginId of owned.reverse()) {
          const entry = active.get(pluginId)
          active.delete(pluginId)
          try { await entry.stop() } catch { /* activation error remains authoritative */ }
        }
        throw error
      }
    },
    activeIds() { return [...active.keys()] },
    async shutdown() {
      const entries = [...active.entries()].sort((a, b) => b[1].order - a[1].order)
      active.clear()
      const errors = []
      for (const [, entry] of entries) try { await entry.stop() } catch (error) { errors.push(error) }
      if (errors.length > 0) throw new AggregateError(errors, 'plugin shutdown failed')
    },
  }
}

module.exports = { createPluginManager }
