const { validateGraph } = require('./graph')

async function runScheduler(tasks, options) {
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new TypeError('concurrency must be positive')
  validateGraph(tasks)
  const statuses = new Map(tasks.map(task => [task.id, { status: 'pending' }]))
  let active = 0
  return new Promise(resolve => {
    const advance = () => {
      let changed = true
      while (changed) {
        changed = false
        for (const task of tasks) {
          if (statuses.get(task.id).status !== 'pending') continue
          const blocked = task.deps.filter(id => ['rejected', 'blocked'].includes(statuses.get(id).status))
          if (blocked.length > 0) { statuses.set(task.id, { status: 'blocked', dependencies: blocked }); changed = true }
        }
      }
      for (const task of tasks) {
        if (active >= options.concurrency) break
        if (statuses.get(task.id).status !== 'pending') continue
        if (!task.deps.every(id => statuses.get(id).status === 'fulfilled')) continue
        statuses.set(task.id, { status: 'running' })
        active += 1
        Promise.resolve().then(task.run).then(
          value => statuses.set(task.id, { status: 'fulfilled', value }),
          reason => statuses.set(task.id, { status: 'rejected', reason }),
        ).finally(() => { active -= 1; advance() })
      }
      if (active === 0 && [...statuses.values()].every(status => !['pending', 'running'].includes(status.status))) resolve(statuses)
    }
    advance()
  })
}

module.exports = { runScheduler }
