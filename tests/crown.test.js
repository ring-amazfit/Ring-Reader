const assert = require('assert')
const fs = require('fs')
const vm = require('vm')

const source = fs.readFileSync(require.resolve('../utils/crown.js'), 'utf8')
const commonJs = source.replace(/export function /g, 'function ') + '\nmodule.exports = { crownDirection, crownDebounceMs, keyDirection }\n'
const sandbox = { module: { exports: {} } }
vm.runInNewContext(commonJs, sandbox, { filename: 'utils/crown.js' })
const { crownDirection, crownDebounceMs, keyDirection } = sandbox.module.exports

assert.strictEqual(crownDirection(36, 1, 36), 1, 'positive degree should move forward')
assert.strictEqual(crownDirection(36, -1, 36), -1, 'negative degree should move backward')
assert.strictEqual(crownDirection(36, 0, 36), 0, 'press event must not navigate')
assert.strictEqual(crownDirection(36, undefined, 36), 0, 'missing degree must not navigate')
assert.strictEqual(crownDirection(13, 10, 36), 0, 'non-crown key must not navigate')
assert.strictEqual(crownDebounceMs(), 120, 'all devices use one light event throttle')
assert.strictEqual(keyDirection(40, 38, 40), 1, 'down key should move forward')
assert.strictEqual(keyDirection(38, 38, 40), -1, 'up key should move backward')
assert.strictEqual(keyDirection(36, 38, 40), 0, 'unrelated key must pass through')
console.log('crown helper tests: passed')
