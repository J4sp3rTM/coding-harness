const { mergeLayers } = require('./merge')
const { validateConfig } = require('./validate')

function resolveConfig(...layers) {
  return validateConfig(mergeLayers(...layers))
}

module.exports = { resolveConfig }
