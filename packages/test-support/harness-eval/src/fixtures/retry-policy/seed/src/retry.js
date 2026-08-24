async function retry(operation) {
  return operation(1)
}

module.exports = { retry }
