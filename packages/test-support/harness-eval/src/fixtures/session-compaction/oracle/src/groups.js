function groupTranscript(messages) {
  const groups = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role === 'tool') throw new Error('tool result must follow its assistant call')
    if (message.role === 'assistant' && Array.isArray(message.toolCalls)) {
      const group = [message]
      for (const callId of message.toolCalls) {
        const result = messages[++index]
        if (result?.role !== 'tool' || result.callId !== callId) throw new Error('tool result does not match assistant call')
        group.push(result)
      }
      groups.push(group)
    } else groups.push([message])
  }
  return groups
}

module.exports = { groupTranscript }
