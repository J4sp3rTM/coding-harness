const { validateEvent } = require('./events')

function replay(definitions, events) {
  const steps = new Map(definitions.map(step => [step.id, { status: 'pending', lease: null, effects: new Set() }]))
  const commandKeys = new Set()
  let sequence = 0
  for (const event of events) {
    validateEvent(event, sequence + 1, steps)
    sequence = event.sequence
    if (commandKeys.has(event.commandKey)) continue
    commandKeys.add(event.commandKey)
    const step = steps.get(event.stepId)
    if (event.type === 'step-leased') {
      if (step.status === 'completed') throw new Error('completed step cannot be leased')
      step.status = 'running'
      step.lease = { id: event.leaseId, expiresAt: event.expiresAt }
    } else if (event.type === 'effect-completed') step.effects.add(event.effectId)
    else if (event.type === 'step-completed') { step.status = 'completed'; step.lease = null }
    else if (event.type === 'step-failed') { step.status = 'failed'; step.lease = null }
  }
  return { sequence, steps, commandKeys }
}

module.exports = { replay }
