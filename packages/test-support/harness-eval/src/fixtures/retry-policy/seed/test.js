const assert = require('node:assert/strict')
const { retry } = require('./src/retry')
const { TransientError } = require('./src/errors')

async function main() {
  const delays = []
  let calls = 0
  const value = await retry(async attempt => {
    calls += 1
    assert.equal(attempt, calls)
    if (calls < 3) throw new TransientError('again')
    return 'ok'
  }, { retries: 3, baseDelay: 10, delay: async ms => { delays.push(ms) } })
  assert.equal(value, 'ok')
  assert.deepEqual(delays, [10, 20])

  calls = 0
  await assert.rejects(() => retry(async () => { calls += 1; throw new Error('permanent') }, { retries: 5, delay: async () => {} }), /permanent/)
  assert.equal(calls, 1)

  const controller = new AbortController()
  calls = 0
  await assert.rejects(() => retry(async () => {
    calls += 1
    controller.abort(new Error('stop'))
    throw new TransientError('again')
  }, { retries: 5, signal: controller.signal, delay: async () => { throw new Error('delay must not run') } }), /stop/)
  assert.equal(calls, 1)
  console.log('retry-policy: PASS')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
