'use strict'
function assertKey(key) {
  if (typeof key !== 'string' || key.length === 0) throw new Error('invalid key')
}
module.exports = { assertKey }
