'use strict'
function displayName(record) {
  if (record.kind !== 'user') throw new Error('not a user')
  return record.name
}
module.exports = { displayName }
