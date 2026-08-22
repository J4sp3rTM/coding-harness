function mergeLayers(...layers) {
  return layers.at(-1) ?? {}
}

module.exports = { mergeLayers }
