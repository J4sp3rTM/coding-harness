function createToolRuntime({ registry, audit, authorize }) {
  return {
    async invoke(request, options = {}) {
      const base = { tenantId: request.tenantId, sessionId: request.sessionId, tool: request.tool }
      if (!authorize(request)) {
        audit.append({ ...base, outcome: 'denied' })
        throw new Error('permission denied')
      }
      const controller = new AbortController()
      let abortKind = null
      const onAbort = () => { abortKind = 'cancelled'; controller.abort(options.signal.reason ?? new Error('cancelled')) }
      if (options.signal?.aborted) onAbort()
      else options.signal?.addEventListener('abort', onAbort, { once: true })
      const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
        abortKind = 'timed-out'
        controller.abort(new Error('tool invocation timed out'))
      }, options.timeoutMs)
      let resource
      try {
        const tool = await registry.resolve({ tenantId: request.tenantId, sessionId: request.sessionId, name: request.tool })
        resource = await tool.acquire()
        const result = await resource.run(request.args, controller.signal)
        audit.append({ ...base, outcome: 'completed' })
        return result
      } catch (error) {
        audit.append({ ...base, outcome: abortKind ?? 'failed' })
        throw error
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        if (resource !== undefined) await resource.release()
      }
    },
  }
}

module.exports = { createToolRuntime }
