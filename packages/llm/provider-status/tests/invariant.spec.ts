import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ProviderStatusInvariant from '../src/invariant.ts'

describe('provider-status invariant companion', () => {
  it('reserves the package name against duplicate registration', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(ProviderStatusInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-provider-status', () => {})
    }).toThrow(/already registered/)
  })
})
