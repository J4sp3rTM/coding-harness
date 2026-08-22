function validatePlugins(plugins) {
  const byId = new Map()
  for (const plugin of plugins) {
    if (byId.has(plugin.id)) throw new Error(`duplicate plugin ${plugin.id}`)
    byId.set(plugin.id, plugin)
  }
  for (const plugin of plugins) for (const dependency of plugin.deps) if (!byId.has(dependency)) throw new Error(`missing dependency ${dependency}`)
  const visiting = new Set()
  const visited = new Set()
  const visit = id => {
    if (visiting.has(id)) throw new Error('plugin dependency cycle')
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of byId.get(id).deps) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const plugin of plugins) visit(plugin.id)
  return byId
}

module.exports = { validatePlugins }
