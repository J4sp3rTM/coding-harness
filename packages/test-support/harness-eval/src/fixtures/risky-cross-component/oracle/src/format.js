'use strict'
const { displayName } = require('./read.js')
function formatUser(record) {
  return `user:${displayName(record)}`
}
module.exports = { formatUser }
