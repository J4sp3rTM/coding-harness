import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import { LlmOAuthService } from '@deepseek-ai/dsh-llm-oauth'
import type {
  LlmOAuthAccount,
  LlmOAuthInteraction,
  LlmOAuthProviderInfo,
  LlmOAuthToken,
  LlmOAuthTokenStore,
} from '@deepseek-ai/dsh-llm-oauth'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveProfiles } from '../src/config.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
  await closeMockServers()
  vi.unstubAllEnvs()
})

/** A sign-in service whose store is seeded rather than earned through a flow. */
class SeededOAuth extends LlmOAuthService {
  private readonly stored = new Map<string, LlmOAuthToken>()
  private readonly store: LlmOAuthTokenStore

  constructor(ctx: Context, seed: Record<string, LlmOAuthToken> = {}) {
    super(ctx)
    for (const [provider, token] of Object.entries(seed)) this.stored.set(provider, token)
    this.store = {
      read: provider => Promise.resolve(this.stored.get(provider)),
      list: () => Promise.resolve([...this.stored.keys()]),
      modify: async (provider, fn) => {
        const next = await fn(this.stored.get(provider))
        if (next !== undefined) this.stored.set(provider, next)
        return this.stored.get(provider)
      },
      delete: (provider) => {
        this.stored.delete(provider)
        return Promise.resolve()
      },
    }
  }

  override providers(): readonly LlmOAuthProviderInfo[] {
    return [{ provider: 'openrouter', displayName: 'OpenRouter', loginLabel: 'Sign in with OpenRouter' }]
  }

  override accounts(): Promise<readonly LlmOAuthAccount[]> {
    return Promise.resolve([])
  }

  override status(): Promise<LlmOAuthAccount> {
    return Promise.reject(new Error('unused'))
  }

  override login(_provider: string, _interaction: LlmOAuthInteraction): Promise<LlmOAuthAccount> {
    return Promise.reject(new Error('unused'))
  }

  override logout(): Promise<void> {
    return Promise.resolve()
  }

  override tokens(): LlmOAuthTokenStore {
    return this.store
  }
}

async function home(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pi-subscription-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** The composition under test: the adapter beside the credential seam, with the sign-in seam optional. */
async function boot(
  dir: string,
  config: LlmPiAi.Config,
  seed?: Record<string, LlmOAuthToken>,
): Promise<Context> {
  const ctx = new Context()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
  })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  if (seed !== undefined) await ctx.plugin(SeededOAuth, seed)
  await ctx.plugin(LlmPiAi, config)
  return ctx
}

/**
 * One catalog route that can be signed into, pointed at a local endpoint.
 *
 * A subscription route must be one the installed catalog ships an OAuth method
 * for — a hand-declared gateway has no flow and no OAuth method on its built
 * provider — so these tests use `openrouter`, whose models speak the same
 * `openai-completions` protocol the mock endpoint does.
 */
function route(baseURL: string, extra: Partial<LlmPiAi.PiAiProviderProfile> = {}): LlmPiAi.Config {
  return {
    providers: {
      openrouter: {
        baseURL,
        models: [{ id: 'sub-model', contextWindow: 4096, maxTokens: 256 }],
        ...extra,
      },
    },
  }
}

const TOKEN: LlmOAuthToken = { access: 'sk-ant-oat-token', refresh: 'r', expires: Date.now() + 600_000 }

describe('subscription-authenticated routes', () => {
  it('authenticates with the stored token instead of the profile\'s key reference', async () => {
    const server = await mockServer([{ events: textEvents }])
    const dir = await home()
    await writeFile(join(dir, '.credentials.yaml'), 'PI_SUB_KEY: from-the-key-store\n', { mode: 0o600 })
    const ctx = await boot(dir, route(server.url, { apiKeyEnv: 'PI_SUB_KEY' }), { openrouter: TOKEN })

    await assemble(ctx, { provider: 'openrouter', model: 'sub-model', messages: [] })

    expect(server.headers[0]?.authorization).toBe(`Bearer ${TOKEN.access}`)
  })

  it('keeps harness attribution on subscription providers without a required client identity', async () => {
    const server = await mockServer([{ events: textEvents }, { events: textEvents }])
    const dir = await home()
    await writeFile(join(dir, '.credentials.yaml'), 'PI_SUB_KEY: k\n', { mode: 0o600 })
    const ctx = await boot(dir, route(server.url, { apiKeyEnv: 'PI_SUB_KEY' }), { openrouter: TOKEN })

    await assemble(ctx, { provider: 'openrouter', model: 'sub-model', messages: [] })
    const subscriptionAgent = server.headers[0]?.['user-agent']

    // The same route signed out sends attribution again.
    await ctx.get('llmOAuth')?.tokens().delete('openrouter')
    await assemble(ctx, { provider: 'openrouter', model: 'sub-model', messages: [] })

    expect(subscriptionAgent).toContain('deepseek-harness')
    expect(server.headers[1]?.['user-agent']).toContain('deepseek-harness')
  })

  it('withholds harness attribution from an Anthropic subscription request', async () => {
    const server = await mockServer([{ events: textEvents }])
    const dir = await home()
    const ctx = await boot(dir, {
      providers: {
        anthropic: {
          api: 'openai-completions',
          baseURL: server.url,
          models: [{ id: 'sub-model', contextWindow: 4096, maxTokens: 256 }],
        },
      },
    }, { anthropic: TOKEN })

    await assemble(ctx, { provider: 'anthropic', model: 'sub-model', messages: [] })

    expect(server.headers[0]?.['user-agent']).not.toContain('deepseek-harness')
  })

  it('falls back to the key path when the route is signed out', async () => {
    const server = await mockServer([{ events: textEvents }])
    const dir = await home()
    await writeFile(join(dir, '.credentials.yaml'), 'PI_SUB_KEY: from-the-key-store\n', { mode: 0o600 })
    const ctx = await boot(dir, route(server.url, { apiKeyEnv: 'PI_SUB_KEY' }), {})

    await assemble(ctx, { provider: 'openrouter', model: 'sub-model', messages: [] })

    expect(server.headers[0]?.authorization).toBe('Bearer from-the-key-store')
  })

  it('keeps using the key when the profile pins auth: api-key, even while signed in', async () => {
    const server = await mockServer([{ events: textEvents }])
    const dir = await home()
    await writeFile(join(dir, '.credentials.yaml'), 'PI_SUB_KEY: from-the-key-store\n', { mode: 0o600 })
    const ctx = await boot(dir, route(server.url, { apiKeyEnv: 'PI_SUB_KEY', auth: 'api-key' }), { openrouter: TOKEN })

    await assemble(ctx, { provider: 'openrouter', model: 'sub-model', messages: [] })

    expect(server.headers[0]?.authorization).toBe('Bearer from-the-key-store')
    expect(server.headers[0]?.['user-agent']).toContain('deepseek-harness')
  })

  it('refuses the request rather than falling back to an ambient key when a subscription route is signed out', async () => {
    const server = await mockServer([{ events: textEvents }])
    const dir = await home()
    await writeFile(join(dir, '.credentials.yaml'), 'PI_SUB_KEY: from-the-key-store\n', { mode: 0o600 })
    const ctx = await boot(dir, route(server.url, { apiKeyEnv: 'PI_SUB_KEY', auth: 'subscription' }), {})

    const result = await assemble(ctx, { provider: 'openrouter', model: 'sub-model', messages: [] })

    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'MISSING_SUBSCRIPTION' } })
    // Nothing was sent: the refusal happens before the request is built.
    expect(server.headers).toHaveLength(0)
  })

  it('leaves every route on the key path when no sign-in service is composed', async () => {
    const server = await mockServer([{ events: textEvents }])
    const dir = await home()
    await writeFile(join(dir, '.credentials.yaml'), 'PI_SUB_KEY: from-the-key-store\n', { mode: 0o600 })
    const ctx = await boot(dir, route(server.url, { apiKeyEnv: 'PI_SUB_KEY' }))

    await assemble(ctx, { provider: 'openrouter', model: 'sub-model', messages: [] })

    expect(server.headers[0]?.authorization).toBe('Bearer from-the-key-store')
  })
})

describe('auth-mode configuration', () => {
  it('refuses auth: subscription on a catalog route that cannot be signed into', () => {
    expect(() => resolveProfiles({ deepseek: { auth: 'subscription' } }))
      .toThrow(/offers no subscription sign-in/)
  })

  it('accepts auth: subscription on a catalog route that can be', () => {
    expect(resolveProfiles({ anthropic: { auth: 'subscription' } }).get('anthropic')?.auth)
      .toBe('subscription')
  })
})

describe('the configurable-provider directory', () => {
  it('offers a catalog route whose only method is a subscription sign-in', async () => {
    const dir = await home()
    const ctx = await boot(dir, {})
    expect(ctx.llm.listConfigurableProviders().map(entry => entry.provider)).toContain('openai-codex')
  })
})
