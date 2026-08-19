import type { Context } from '@deepseek-ai/cordis'
import { LlmOAuthError, LlmOAuthService } from '../src/index.ts'
import type {
  LlmOAuthAccount,
  LlmOAuthInteraction,
  LlmOAuthProviderInfo,
  LlmOAuthToken,
  LlmOAuthTokenStore,
} from '../src/index.ts'

/**
 * In-memory sign-in provider for seam and consumer tests: one offered route
 * whose flow answers the caller's own prompt, and a store with no durability.
 */
export class MemoryLlmOAuth extends LlmOAuthService {
  private readonly stored = new Map<string, LlmOAuthToken>()
  private readonly offered: readonly LlmOAuthProviderInfo[]
  private readonly store: LlmOAuthTokenStore

  constructor(ctx: Context, offered: readonly LlmOAuthProviderInfo[] = [
    { provider: 'anthropic', displayName: 'Anthropic', loginLabel: 'Anthropic (Claude Pro/Max)' },
  ]) {
    super(ctx)
    this.offered = offered
    this.store = {
      read: provider => Promise.resolve(this.stored.get(provider)),
      list: () => Promise.resolve([...this.stored.keys()]),
      modify: async (provider, fn) => {
        const next = await fn(this.stored.get(provider))
        if (next === undefined) return this.stored.get(provider)
        this.stored.set(provider, next)
        this.notifyUpdated(provider)
        return next
      },
      delete: (provider) => {
        if (this.stored.delete(provider)) this.notifyUpdated(provider)
        return Promise.resolve()
      },
    }
  }

  /** The offered route under one key, or the seam's unknown-provider failure. */
  private infoOf(provider: string): LlmOAuthProviderInfo {
    const info = this.offered.find(entry => entry.provider === provider)
    if (info === undefined) throw new LlmOAuthError(`memory: no route "${provider}"`, 'UNKNOWN_PROVIDER')
    return info
  }

  /** One route's account facts from what is stored. */
  private accountOf(info: LlmOAuthProviderInfo): LlmOAuthAccount {
    const token = this.stored.get(info.provider)
    return { ...info, signedIn: token !== undefined, ...token === undefined ? {} : { expiresAt: token.expires } }
  }

  override providers(): readonly LlmOAuthProviderInfo[] {
    return this.offered
  }

  override async accounts(): Promise<readonly LlmOAuthAccount[]> {
    await Promise.resolve()
    return this.offered.map(info => this.accountOf(info))
  }

  override async status(provider: string): Promise<LlmOAuthAccount> {
    await Promise.resolve()
    return this.accountOf(this.infoOf(provider))
  }

  override async login(provider: string, interaction: LlmOAuthInteraction): Promise<LlmOAuthAccount> {
    const info = this.infoOf(provider)
    interaction.notify({ kind: 'auth-url', url: `https://example.test/${provider}` })
    const access = await interaction.prompt({ kind: 'manual-code', message: 'Paste the redirect URL:' })
    await this.store.modify(provider, () => Promise.resolve({ access, refresh: 'refresh', expires: 4_242 }))
    return this.accountOf(info)
  }

  override async logout(provider: string): Promise<void> {
    this.infoOf(provider)
    await this.store.delete(provider)
  }

  override tokens(): LlmOAuthTokenStore {
    return this.store
  }
}
