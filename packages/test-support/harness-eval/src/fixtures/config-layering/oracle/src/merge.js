function isPlain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone)
  if (!isPlain(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
}

function mergeLayers(...layers) {
  const merge = (base, override) => {
    const output = isPlain(base) ? clone(base) : {}
    if (!isPlain(override)) return override === undefined ? output : clone(override)
    for (const [key, value] of Object.entries(override)) {
      if (value === undefined) continue
      output[key] = isPlain(value) && isPlain(output[key]) ? merge(output[key], value) : clone(value)
    }
    return output
  }
  return layers.reduce(merge, {})
}

module.exports = { mergeLayers }
