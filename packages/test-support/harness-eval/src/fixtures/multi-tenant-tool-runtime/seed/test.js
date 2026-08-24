const assert = require('node:assert/strict')
const { createAuditLog } = require('./src/audit')
const { createRegistry } = require('./src/registry')
const { createToolRuntime } = require('./src/runtime')

async function main() {
  const resolutions = []
  let releases = 0
  const registry = createRegistry(async scope => {
    resolutions.push(`${scope.tenantId}/${scope.sessionId}/${scope.name}`)
    return { acquire: async () => ({
      run: async (_args, signal) => {
        if (scope.name === 'slow') await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
        return `${scope.tenantId}:${scope.sessionId}`
      },
      release: async () => { releases += 1 },
    }) }
  })
  const audit = createAuditLog()
  const runtime = createToolRuntime({ registry, audit, authorize: request => request.tool !== 'denied' })
  assert.equal(await runtime.invoke({ tenantId: 'a', sessionId: '1', tool: 'echo', args: {} }), 'a:1')
  assert.equal(await runtime.invoke({ tenantId: 'b', sessionId: '1', tool: 'echo', args: {} }), 'b:1')
  assert.equal(await runtime.invoke({ tenantId: 'a', sessionId: '1', tool: 'echo', args: {} }), 'a:1')
  assert.deepEqual(resolutions, ['a/1/echo', 'b/1/echo'])
  await assert.rejects(() => runtime.invoke({ tenantId: 'a', sessionId: '1', tool: 'denied', args: {} }), /permission/)
  assert.equal(resolutions.some(item => item.endsWith('/denied')), false)
  await assert.rejects(() => runtime.invoke({ tenantId: 'a', sessionId: '2', tool: 'slow', args: {} }, { timeoutMs: 5 }), /timed out/)
  const controller = new AbortController()
  const pending = runtime.invoke({ tenantId: 'a', sessionId: '3', tool: 'slow', args: {} }, { signal: controller.signal, timeoutMs: 100 })
  controller.abort(new Error('caller stopped'))
  await assert.rejects(() => pending, /caller stopped/)
  assert.equal(releases, 5)
  const entries = audit.entries()
  assert.deepEqual(entries.map(entry => entry.outcome), ['completed', 'completed', 'completed', 'denied', 'timed-out', 'cancelled'])
  assert.equal(entries.every(Object.isFrozen), true)
  assert.deepEqual(entries.map(entry => entry.sequence), [1, 2, 3, 4, 5, 6])
  console.log('multi-tenant-tool-runtime: PASS')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
