function validateConfig(config) {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new TypeError('port must be an integer from 1 to 65535')
  if (typeof config.endpoint !== 'string' || config.endpoint.length === 0) throw new TypeError('endpoint must be a non-empty string')
  return config
}

module.exports = { validateConfig }
