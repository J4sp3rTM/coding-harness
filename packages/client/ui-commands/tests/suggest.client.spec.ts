import { describe, expect, it } from 'vitest'
import { editDistance, suggestCommands, unknownCommandText } from '../src/client/suggest.ts'

describe('editDistance', () => {
  it('is zero for equal names and symmetric for single edits', () => {
    expect(editDistance('plan', 'plan')).toBe(0)
    expect(editDistance('plan', 'plans')).toBe(1)
    expect(editDistance('plans', 'plan')).toBe(1)
    expect(editDistance('plan', 'goal')).toBe(3)
  })
})

describe('suggestCommands', () => {
  const names = ['clear', 'compact', 'plan', 'permission', 'goal']

  it('ranks prefix matches before near misses and caps at three', () => {
    expect(suggestCommands('per', names)).toEqual(['permission'])
    expect(suggestCommands('pla', names)).toEqual(['plan'])
    expect(suggestCommands('co', names)).toEqual(['compact'])
  })

  it('falls back to near misses and deduplicates prefix hits', () => {
    expect(suggestCommands('planx', names)).toEqual(['plan'])
    expect(suggestCommands('pla', names)).toEqual(['plan'])
  })

  it('excludes the exact name and returns nothing for distant candidates', () => {
    expect(suggestCommands('plan', names)).toEqual([])
    expect(suggestCommands('zzzzzz', names)).toEqual([])
  })
})

describe('unknownCommandText', () => {
  it('keeps the malformed wording when no candidate parsed', () => {
    expect(unknownCommandText('/1nv4lid', undefined, ['clear'])).toBe('unknown or malformed command: /1nv4lid')
  })

  it('states the unknown command without suggestions when nothing is close', () => {
    expect(unknownCommandText('/zzzzzz', 'zzzzzz', ['clear'])).toBe('unknown command: /zzzzzz')
  })

  it('suggests one near miss', () => {
    expect(unknownCommandText('/clea', 'clea', ['clear', 'goal']))
      .toBe('unknown command: /clea — did you mean /clear?')
  })

  it('joins multiple suggestions with a final or', () => {
    const text = unknownCommandText('/cle', 'cle', ['clip', 'clean', 'goal', 'clear', 'compact'])
    expect(text).toBe('unknown command: /cle — did you mean /clean, /clear or /clip?')
  })
})
