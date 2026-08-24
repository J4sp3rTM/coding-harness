const TYPES = new Set(['step-leased', 'effect-completed', 'step-completed', 'step-failed'])

function validateEvent(event, expectedSequence, steps) {
  if (event.sequence !== expectedSequence) throw new Error(`event sequence must be ${expectedSequence}`)
  if (!TYPES.has(event.type)) throw new Error(`unknown event ${event.type}`)
  if (!steps.has(event.stepId)) throw new Error(`unknown step ${event.stepId}`)
  if (typeof event.commandKey !== 'string' || event.commandKey.length === 0) throw new Error('commandKey is required')
}

module.exports = { validateEvent }
