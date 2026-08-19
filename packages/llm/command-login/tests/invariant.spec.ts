import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as CommandLoginInvariant from '../src/invariant.ts'

describe('command-login invariant companion', () => {
  it('reserves the package name against duplicate registration', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(CommandLoginInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-command-login', () => {})
    }).toThrow(/already registered/)
  })
})
