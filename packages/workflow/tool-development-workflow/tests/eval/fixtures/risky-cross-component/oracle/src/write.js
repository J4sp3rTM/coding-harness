'use strict'
const { user } = require('./contract.js')
function rename(record, next) {
  if (record.kind !== 'user') throw new Error('not a user')
  return user(next)
}
module.exports = { rename }
