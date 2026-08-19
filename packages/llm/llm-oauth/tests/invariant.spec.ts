import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as LlmOAuthInvariant from '../src/invariant.ts'
import { MemoryLlmOAuth } from './memory.ts'

describe('llm-oauth invariant companion', () => {
  it('accepts a committed change emitted by a live service', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(LlmOAuthInvariant)
    await ctx.plugin(MemoryLlmOAuth)

    await expect(ctx.llmOAuth.login('anthropic', {
      notify: () => {},
      prompt: () => Promise.resolve('code'),
    })).resolves.toMatchObject({ signedIn: true })
  })

  it('fails an update event emitted without a live service', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(LlmOAuthInvariant)

    expect(() => { ctx.emit('llm-oauth/updated', 'anthropic') })
      .toThrow(/invariant violated by "@deepseek-ai\/dsh-llm-oauth"/)
  })

  it('reserves the package name against duplicate registration', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(LlmOAuthInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-llm-oauth', () => {})
    }).toThrow(/already registered/)
  })
})
