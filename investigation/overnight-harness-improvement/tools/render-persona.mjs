/** Renders the persona row of a preset yml to verify exact folded text. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const YAML = require('../../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml')
const file = process.argv[2]
const doc = YAML.parse(readFileSync(file, 'utf8'))
const row = doc.find(entry => entry.id === 'persona')
process.stdout.write('---rendered---\n')
process.stdout.write(`${row.config.text}\n`)
process.stdout.write('---json---\n')
process.stdout.write(`${JSON.stringify(row.config.text)}\n`)
