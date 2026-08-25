import { describe, expect, it } from 'vitest'
import { isGreenAccentId } from '../src/accent.ts'

describe('isGreenAccentId', () => {
  it('accepts the built-in accents and rejects everything else', () => {
    expect(isGreenAccentId('default')).toBe(true)
    expect(isGreenAccentId('green')).toBe(true)
    expect(isGreenAccentId('sepia')).toBe(false)
    expect(isGreenAccentId(undefined)).toBe(false)
  })
})
