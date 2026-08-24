const { reduceEvent } = require('./reducer')

function projectSession(events) {
  let state = null
  let sequence = 0
  for (const event of events) {
    if (event.sequence !== sequence + 1) throw new Error(`sequence must be ${sequence + 1}`)
    state = reduceEvent(state, event)
    sequence = event.sequence
  }
  return state
}

module.exports = { projectSession }
