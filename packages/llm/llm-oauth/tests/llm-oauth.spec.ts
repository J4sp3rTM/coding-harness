import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmOAuthError } from '../src/index.ts'
import { MemoryLlmOAuth } from './memory.ts'

async function boot(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MemoryLlmOAuth)
  return ctx
}

/** A surface answering every prompt with one canned reply. */
function interaction(answer = 'code'): Parameters<Context['llmOAuth']['login']>[1] {
  return { notify: () => {}, prompt: () => Promise.resolve(answer) }
}

describe('the sign-in seam through the memory provider', () => {
  it('mounts as ctx.llmOAuth and reports an offered route signed out', async () => {
    const ctx = await boot()
    expect(ctx.llmOAuth.providers()).toEqual([
      { provider: 'anthropic', displayName: 'Anthropic', loginLabel: 'Anthropic (Claude Pro/Max)' },
    ])
    expect(await ctx.llmOAuth.status('anthropic')).toMatchObject({ signedIn: false })
    expect(await ctx.llmOAuth.accounts()).toEqual([expect.objectContaining({ signedIn: false })])
  })

  it('carries the flow through the caller\'s surface and reports the route signed in', async () => {
    const ctx = await boot()
    const account = await ctx.llmOAuth.login('anthropic', interaction('pasted-code'))
    expect(account).toMatchObject({ signedIn: true, expiresAt: 4_242 })
    expect(await ctx.llmOAuth.tokens().read('anthropic')).toMatchObject({ access: 'pasted-code' })
  })

  it('emits the committed change once per stored write', async () => {
    const ctx = await boot()
    const updated: string[] = []
    ctx.on('llm-oauth/updated', provider => void updated.push(provider))
    await ctx.llmOAuth.login('anthropic', interaction())
    await ctx.llmOAuth.logout('anthropic')
    // Signing out twice commits once: the second removal changes nothing.
    await ctx.llmOAuth.logout('anthropic')
    expect(updated).toEqual(['anthropic', 'anthropic'])
  })

  it('refuses a route it does not offer', async () => {
    const ctx = await boot()
    await expect(ctx.llmOAuth.status('openai-codex')).rejects.toBeInstanceOf(LlmOAuthError)
  })

  it('leaves the stored entry untouched when a transformation declines', async () => {
    const ctx = await boot()
    await ctx.llmOAuth.login('anthropic', interaction('first'))
    const kept = await ctx.llmOAuth.tokens().modify('anthropic', () => Promise.resolve(undefined))
    expect(kept).toMatchObject({ access: 'first' })
  })
})

describe('llm-oauth/updated listener containment', () => {
  it('logs a failing listener without changing the committed outcome', async () => {
    const ctx = await boot()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ctx.on('llm-oauth/updated', () => { throw new Error('observer failed') })
    // The declared listener signature is void, so an async listener reaches
    // the seam only by returning a thenable the type does not describe — which
    // is exactly the case the containment path exists for.
    const asyncListener = (): void => Promise.reject(new Error('async observer failed')) as never
    ctx.on('llm-oauth/updated', asyncListener)
    const reached: string[] = []
    ctx.on('llm-oauth/updated', provider => void reached.push(provider))

    await expect(ctx.llmOAuth.login('anthropic', interaction())).resolves.toMatchObject({ signedIn: true })
    // Every listener ran, and the rejection settled before the assertion below.
    await Promise.resolve()
    expect(reached).toEqual(['anthropic'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('rethrows an invariant failure after every listener ran', async () => {
    const ctx = await boot()
    const invariant = Object.assign(new Error('invariant broken'), { code: 'INVARIANT' })
    ctx.on('llm-oauth/updated', () => { throw invariant })
    const reached: string[] = []
    ctx.on('llm-oauth/updated', provider => void reached.push(provider))
    await expect(ctx.llmOAuth.login('anthropic', interaction())).rejects.toBe(invariant)
    expect(reached).toEqual(['anthropic'])
  })
})

describe('LlmOAuthError', () => {
  it('carries a stable code and its own name', () => {
    const error = new LlmOAuthError('nope', 'LOGIN_FAILED', { cause: new Error('inner') })
    expect(error.code).toBe('LOGIN_FAILED')
    expect(error.name).toBe('LlmOAuthError')
    expect(error.cause).toBeInstanceOf(Error)
  })
})
