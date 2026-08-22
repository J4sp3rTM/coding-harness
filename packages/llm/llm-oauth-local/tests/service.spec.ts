import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LlmOAuthError } from '@deepseek-ai/dsh-llm-oauth'
import type { LlmOAuthInteraction } from '@deepseek-ai/dsh-llm-oauth'
import type { OAuthCredential, ProviderAuthInteraction } from '@earendil-works/pi-ai'

/** The one catalog flow these tests sign in through; the real ones open a browser. */
const login = vi.fn<(interaction: ProviderAuthInteraction) => Promise<OAuthCredential>>()

vi.mock('../src/flows.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/flows.ts')>()
  const fake = {
    provider: 'anthropic',
    displayName: 'Anthropic',
    loginLabel: 'Anthropic (Claude Pro/Max)',
    auth: {
      name: 'Anthropic (Claude Pro/Max)',
      login: (interaction: ProviderAuthInteraction) => login(interaction),
      refresh: () => Promise.reject(new Error('unused')),
      toAuth: () => Promise.reject(new Error('unused')),
    },
  }
  const flows = new Map([['anthropic', fake]])
  return {
    ...original,
    oauthFlows: () => flows,
    oauthFlow: (provider: string) => {
      const flow = flows.get(provider)
      if (flow === undefined) throw new LlmOAuthError(`no flow for ${provider}`, 'UNKNOWN_PROVIDER')
      return flow
    },
  }
})

const { LocalLlmOAuthService, OAUTH_FILENAME, resolveSpec } = await import('../src/index.ts')

const cleanups: Array<() => Promise<void>> = []
let home: string

beforeEach(async () => {
  login.mockReset()
  home = await mkdtemp(join(tmpdir(), 'dsh-llm-oauth-service-'))
  cleanups.push(() => rm(home, { recursive: true, force: true }))
})

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function boot(config: { providers?: string[] } = {}): Promise<Context> {
  const ctx = new Context()
  const fiber = ctx.plugin(LocalLlmOAuthService, { dshHome: home, ...config })
  cleanups.push(async () => {
    await fiber.dispose()
  })
  await fiber
  return ctx
}

/** A surface that answers every question with one canned reply. */
function interaction(answer = 'pasted'): LlmOAuthInteraction {
  return { notify: () => {}, prompt: () => Promise.resolve(answer) }
}

const credential: OAuthCredential = { type: 'oauth', access: 'a1', refresh: 'r1', expires: 4_242 }

describe('resolveSpec', () => {
  it('puts the document under the harness home by default', () => {
    expect(resolveSpec({ dshHome: home }).filename).toBe(join(home, OAUTH_FILENAME))
  })

  it('takes an explicit path over the harness home', () => {
    expect(resolveSpec({ path: join(home, 'elsewhere.json'), dshHome: home }).filename)
      .toBe(join(home, 'elsewhere.json'))
  })

  it('offers the whole catalog when configuration narrows nothing', () => {
    expect(resolveSpec({}).flows.map(flow => flow.provider)).toEqual(['anthropic'])
    expect(resolveSpec({ providers: [] }).flows.map(flow => flow.provider)).toEqual(['anthropic'])
  })

  it('refuses a configured route that cannot be signed into', () => {
    expect(() => resolveSpec({ providers: ['deepseek'] })).toThrow(LlmOAuthError)
  })
})

describe('LocalLlmOAuthService', () => {
  it('publishes the offered routes and reports them signed out', async () => {
    const ctx = await boot()
    expect(ctx.llmOAuth.providers()).toEqual([
      { provider: 'anthropic', displayName: 'Anthropic', loginLabel: 'Anthropic (Claude Pro/Max)' },
    ])
    expect(await ctx.llmOAuth.accounts()).toEqual([
      { provider: 'anthropic', displayName: 'Anthropic', loginLabel: 'Anthropic (Claude Pro/Max)', signedIn: false },
    ])
    expect(await ctx.llmOAuth.status('anthropic')).toMatchObject({ signedIn: false })
  })

  it('stores the flow\'s token set and reports the route signed in', async () => {
    const ctx = await boot()
    const updated: string[] = []
    ctx.on('llm-oauth/updated', provider => updated.push(provider))
    login.mockResolvedValue(credential)
    const account = await ctx.llmOAuth.login('anthropic', interaction())
    expect(account).toMatchObject({ provider: 'anthropic', signedIn: true, expiresAt: 4_242 })
    expect(await ctx.llmOAuth.tokens().read('anthropic')).toEqual({ access: 'a1', refresh: 'r1', expires: 4_242 })
    expect(await ctx.llmOAuth.accounts()).toEqual([expect.objectContaining({ signedIn: true, expiresAt: 4_242 })])
    expect(updated).toEqual(['anthropic'])
  })

  it('reports a non-refreshable grant as signed in', async () => {
    const ctx = await boot()
    login.mockResolvedValue({ ...credential, refresh: '', expires: Number.MAX_SAFE_INTEGER })
    await expect(ctx.llmOAuth.login('anthropic', interaction()))
      .resolves.toMatchObject({ signedIn: true, expiresAt: Number.MAX_SAFE_INTEGER })
    await expect(ctx.llmOAuth.accounts())
      .resolves.toEqual([expect.objectContaining({ signedIn: true })])
  })

  it('hands the flow a surface that reaches the caller', async () => {
    const ctx = await boot()
    login.mockImplementation(async (piInteraction) => {
      expect(piInteraction.signal.aborted).toBe(false)
      piInteraction.notify({ type: 'progress', message: 'exchanging' })
      const answer = await piInteraction.prompt({ type: 'manual_code', message: 'paste?' })
      return { ...credential, access: answer }
    })
    await ctx.llmOAuth.login('anthropic', interaction('code-from-human'))
    expect((await ctx.llmOAuth.tokens().read('anthropic'))?.access).toBe('code-from-human')
  })

  it('reports a cancelled sign-in apart from a failed one', async () => {
    const ctx = await boot()
    const controller = new AbortController()
    login.mockImplementation(() => {
      controller.abort()
      return Promise.reject(new Error('aborted'))
    })
    await expect(ctx.llmOAuth.login('anthropic', { ...interaction(), signal: controller.signal }))
      .rejects.toMatchObject({ code: 'LOGIN_ABORTED' })
    expect(login.mock.calls[0]?.[0].signal).toBe(controller.signal)
    login.mockRejectedValue(new Error('token exchange failed'))
    await expect(ctx.llmOAuth.login('anthropic', interaction()))
      .rejects.toMatchObject({ code: 'LOGIN_FAILED' })
    expect(await ctx.llmOAuth.tokens().read('anthropic')).toBeUndefined()
  })

  it('signs out by removing the stored token set', async () => {
    const ctx = await boot()
    login.mockResolvedValue(credential)
    await ctx.llmOAuth.login('anthropic', interaction())
    await ctx.llmOAuth.logout('anthropic')
    expect(await ctx.llmOAuth.status('anthropic')).toMatchObject({ signedIn: false })
    // Signing out a signed-out route is a no-op rather than a failure.
    await expect(ctx.llmOAuth.logout('anthropic')).resolves.toBeUndefined()
  })

  it('refuses every operation on a route it does not offer', async () => {
    const ctx = await boot()
    await expect(ctx.llmOAuth.status('deepseek')).rejects.toMatchObject({ code: 'UNKNOWN_PROVIDER' })
    await expect(ctx.llmOAuth.login('deepseek', interaction())).rejects.toMatchObject({ code: 'UNKNOWN_PROVIDER' })
    await expect(ctx.llmOAuth.logout('deepseek')).rejects.toMatchObject({ code: 'UNKNOWN_PROVIDER' })
  })

  it('contains a surface that fails to render a flow event', async () => {
    const ctx = await boot()
    login.mockImplementation((piInteraction) => {
      piInteraction.notify({ type: 'progress', message: 'exchanging' })
      return Promise.resolve(credential)
    })
    const account = await ctx.llmOAuth.login('anthropic', {
      notify: () => { throw new Error('no renderer') },
      prompt: () => Promise.resolve(''),
    })
    expect(account.signedIn).toBe(true)
  })

  it('withdraws the service on disposal', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(LocalLlmOAuthService, { dshHome: home })
    await fiber
    expect(ctx.get('llmOAuth')).toBeDefined()
    await fiber.dispose()
    expect(ctx.get('llmOAuth')).toBeUndefined()
  })
})
