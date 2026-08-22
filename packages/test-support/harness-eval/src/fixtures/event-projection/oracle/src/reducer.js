function reduceEvent(state, event) {
  if (event.type === 'created') {
    if (state !== null) throw new Error('session already created')
    return { id: event.id, title: event.title, messages: [], deleted: false, sequence: event.sequence }
  }
  if (state === null) throw new Error('created event must be first')
  if (state.deleted) throw new Error('deleted session cannot change')
  if (event.type === 'renamed') return { ...state, title: event.title, sequence: event.sequence }
  if (event.type === 'message') return { ...state, messages: [...state.messages, { role: event.role, text: event.text }], sequence: event.sequence }
  if (event.type === 'deleted') return { ...state, deleted: true, sequence: event.sequence }
  if (event.ignorable === true) return { ...state, sequence: event.sequence }
  throw new Error(`unknown event ${event.type}`)
}

module.exports = { reduceEvent }
