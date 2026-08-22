function groupTranscript(messages) {
  return messages.map(message => [message])
}

module.exports = { groupTranscript }
