const assert = require('node:assert/strict')
const { runScheduler } = require('./src/scheduler')

async function main() {
  let active = 0
  let maximum = 0
  const started = []
  const task = (id, deps, result, fail = false) => ({ id, deps, run: async () => {
    started.push(id)
    active += 1
    maximum = Math.max(maximum, active)
    await new Promise(resolve => setTimeout(resolve, id === 'a' ? 8 : 2))
    active -= 1
    if (fail) throw new Error(`failed:${id}`)
    return result
  } })
  const statuses = await runScheduler([
    task('a', [], 1), task('b', [], 2), task('c', ['a'], 3, true), task('d', ['c'], 4), task('e', ['b'], 5),
  ], { concurrency: 2 })
  assert.equal(maximum, 2)
  assert.deepEqual(started.slice(0, 2), ['a', 'b'])
  assert.equal(statuses.get('a').status, 'fulfilled')
  assert.equal(statuses.get('c').status, 'rejected')
  assert.deepEqual(statuses.get('d'), { status: 'blocked', dependencies: ['c'] })
  assert.equal(statuses.get('e').value, 5)
  await assert.rejects(() => runScheduler([{ id: 'a', deps: ['missing'], run: async () => 1 }], { concurrency: 1 }), /missing/)
  await assert.rejects(() => runScheduler([{ id: 'a', deps: ['b'], run: async () => 1 }, { id: 'b', deps: ['a'], run: async () => 2 }], { concurrency: 1 }), /cycle/)
  console.log('dependency-scheduler: PASS')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
