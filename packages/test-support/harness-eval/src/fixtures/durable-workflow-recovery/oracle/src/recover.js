function planRecovery(definitions, state, now) {
  const commands = []
  for (const definition of definitions) {
    const step = state.steps.get(definition.id)
    if (step.status === 'running' && step.lease.expiresAt <= now) {
      const commandKey = `resume:${definition.id}:${step.lease.id}`
      if (!state.commandKeys.has(commandKey)) commands.push({ type: 'resume', stepId: definition.id, leaseId: step.lease.id, commandKey, completedEffects: [...step.effects].sort() })
      continue
    }
    if (step.status !== 'pending') continue
    if (!definition.deps.every(id => state.steps.get(id)?.status === 'completed')) continue
    const commandKey = `start:${definition.id}`
    if (!state.commandKeys.has(commandKey)) commands.push({ type: 'start', stepId: definition.id, commandKey, completedEffects: [] })
  }
  return commands
}

module.exports = { planRecovery }
