'use strict'
const { createStore } = require('./store.js')
const { assertKey } = require('./validate.js')
function createCheckedStore() {
  const store = createStore()
  return {
    get(key) { assertKey(key); return store.get(key) },
    set(key, value) { assertKey(key); store.set(key, value) },
    has(key) { assertKey(key); return store.has(key) },
  }
}
module.exports = { createCheckedStore }
