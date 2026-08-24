function validateGraph(tasks) {
  const byId = new Map()
  for (const task of tasks) {
    if (byId.has(task.id)) throw new Error(`duplicate task ${task.id}`)
    byId.set(task.id, task)
  }
  for (const task of tasks) for (const dependency of task.deps) if (!byId.has(dependency)) throw new Error(`missing dependency ${dependency}`)
  const visiting = new Set()
  const visited = new Set()
  const visit = (id) => {
    if (visiting.has(id)) throw new Error('dependency cycle')
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of byId.get(id).deps) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const task of tasks) visit(task.id)
  return byId
}

module.exports = { validateGraph }
