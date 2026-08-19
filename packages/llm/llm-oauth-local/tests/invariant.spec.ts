import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import LocalLlmOAuthService from '../src/index.ts'
import * as LocalInvariant from '../src/invariant.ts'

/** A context carrying the invariant registry, the companion, and the live provider. */
async function boot(): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-llm-oauth-invariant-'))
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(LocalInvariant)
  await ctx.plugin(LocalLlmOAuthService, { dshHome: home, providers: ['anthropic'] })
  return { ctx, dispose: () => rm(home, { recursive: true, force: true }) }
}

describe('llm-oauth-local invariant companion', () => {
  it('accepts a committed change naming an offered route', async () => {
    const { ctx, dispose } = await boot()
    expect(() => { ctx.emit('llm-oauth/updated', 'anthropic') }).not.toThrow()
    await dispose()
  })

  it('fails a committed change naming a route the service does not offer', async () => {
    const { ctx, dispose } = await boot()
    expect(() => { ctx.emit('llm-oauth/updated', 'openai-codex') })
      .toThrow(/invariant violated by "@deepseek-ai\/dsh-llm-oauth-local"/)
    await dispose()
  })

  it('stays silent while no sign-in service is live', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(LocalInvariant)
    expect(() => { ctx.emit('llm-oauth/updated', 'anthropic') }).not.toThrow()
  })

  it('reserves the package name against duplicate registration', async () => {
    const { ctx, dispose } = await boot()
    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-llm-oauth-local', () => {})
    }).toThrow(/already registered/)
    await dispose()
  })
})
