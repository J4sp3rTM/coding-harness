'use strict'
const assert = require('node:assert')
const { add, sub, mul, div, mod } = require('./src/ops.js')
assert.strictEqual(add(2, 3), 5)
assert.strictEqual(sub(5, 3), 2)
assert.strictEqual(mul(3, 4), 12)
assert.strictEqual(div(8, 2), 4)
assert.strictEqual(mod(7, 3), 1)
console.log('PASS')
