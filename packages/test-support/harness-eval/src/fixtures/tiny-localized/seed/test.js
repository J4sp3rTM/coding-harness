'use strict'
const assert = require('node:assert')
const { greet } = require('./src/greet.js')
assert.strictEqual(greet('Ada'), 'Hello, Ada!')
console.log('PASS')
