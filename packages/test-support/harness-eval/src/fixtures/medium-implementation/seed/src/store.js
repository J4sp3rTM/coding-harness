'use strict'
function createStore() {
  return {
    get(_key) { throw new Error('not implemented') },
    set(_key, _value) { throw new Error('not implemented') },
    has(_key) { throw new Error('not implemented') },
  }
}
module.exports = { createStore }
