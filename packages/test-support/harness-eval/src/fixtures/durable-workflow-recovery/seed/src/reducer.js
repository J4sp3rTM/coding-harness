function replay() {
  return { sequence: 0, steps: new Map(), commandKeys: new Set() }
}

module.exports = { replay }
