function createStore(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    get version() { return 0 },
    snapshot: () => Object.fromEntries(values),
    subscribe: () => () => {},
    batch: () => {},
  }
}

module.exports = { createStore }
