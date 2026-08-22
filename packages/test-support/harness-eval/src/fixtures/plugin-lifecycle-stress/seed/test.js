const assert = require('node:assert/strict')
const { createPluginManager } = require('./src/manager')

async function main() {
  const log = []
  let okStarts = 0
  const plugin = (id, deps = [], options = {}) => ({ id, deps, start: async () => {
    log.push(`start:${id}`)
    if (id === 'ok') okStarts += 1
    if (options.failStart) throw new Error(`boom:${id}`)
    return async () => { log.push(`stop:${id}`); if (options.failStop) throw new Error(`stop-boom:${id}`) }
  } })
  const manager = createPluginManager([
    plugin('unrelated'), plugin('base'), plugin('feature', ['base']), plugin('broken', ['feature'], { failStart: true }), plugin('ok', ['base']), plugin('bad-stop', [], { failStop: true }),
  ])
  await manager.activate('unrelated')
  await assert.rejects(() => manager.activate('broken'), /boom:broken/)
  assert.deepEqual(log.slice(-5), ['start:base', 'start:feature', 'start:broken', 'stop:feature', 'stop:base'])
  assert.deepEqual(manager.activeIds(), ['unrelated'])
  await Promise.all([manager.activate('ok'), manager.activate('ok')])
  assert.equal(okStarts, 1)
  await manager.activate('bad-stop')
  await assert.rejects(() => manager.shutdown(), error => error instanceof AggregateError && error.errors.length === 1)
  assert.deepEqual(manager.activeIds(), [])
  await manager.shutdown()
  assert.throws(() => createPluginManager([plugin('a', ['missing'])]), /missing/)
  assert.throws(() => createPluginManager([plugin('a', ['b']), plugin('b', ['a'])]), /cycle/)
  console.log('plugin-lifecycle-stress: PASS')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
