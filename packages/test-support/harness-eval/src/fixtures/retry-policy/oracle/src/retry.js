const { TransientError } = require('./errors')

async function retry(operation, options = {}) {
  const retries = options.retries ?? 2
  const baseDelay = options.baseDelay ?? 1
  const delay = options.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const isTransient = options.isTransient ?? (error => error instanceof TransientError)
  for (let attempt = 1; ; attempt += 1) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('aborted')
    try {
      return await operation(attempt)
    } catch (error) {
      if (!isTransient(error) || attempt > retries) throw error
      if (options.signal?.aborted) throw options.signal.reason ?? new Error('aborted')
      await delay(baseDelay * (2 ** (attempt - 1)), options.signal)
    }
  }
}

module.exports = { retry }
