'use strict'
function createStore() {
  const data = new Map()
  return {
    get(key) { return data.get(key) },
    set(key, value) { data.set(key, value) },
    has(key) { return data.has(key) },
  }
}
module.exports = { createStore }
