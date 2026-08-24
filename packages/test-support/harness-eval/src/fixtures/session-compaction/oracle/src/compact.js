const { groupTranscript } = require('./groups')

function compactTranscript(messages, budget) {
  const groups = groupTranscript(messages)
  const systemCount = groups.findIndex(group => group[0].role !== 'system')
  const prefixEnd = systemCount === -1 ? groups.length : systemCount
  const required = new Set(groups.slice(0, prefixEnd))
  let latestUser = null
  for (const group of groups) if (group.some(message => message.role === 'user')) latestUser = group
  if (latestUser !== null) required.add(latestUser)
  const cost = group => group.reduce((sum, message) => sum + message.tokens, 0)
  let used = [...required].reduce((sum, group) => sum + cost(group), 0)
  if (used > budget) throw new Error('budget cannot preserve required messages')
  const kept = new Set(required)
  for (let index = groups.length - 1; index >= prefixEnd; index -= 1) {
    const group = groups[index]
    if (kept.has(group)) continue
    const groupCost = cost(group)
    if (used + groupCost <= budget) { kept.add(group); used += groupCost }
  }
  return groups.filter(group => kept.has(group)).flat().map(message => ({ ...message }))
}

module.exports = { compactTranscript }
