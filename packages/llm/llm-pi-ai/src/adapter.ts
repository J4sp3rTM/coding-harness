/**
 * Generic pi-ai-backed implementation of the Harness LLM seam.
 *
 * Each resolution produces one **immutable** snapshot — the profiles plus a
 * `Models` collection holding the `Provider` each route built — and an
 * operation captures a whole snapshot before its first `await`. A
 * configuration change builds a *new* collection rather than mutating the one
 * in use, because `Models.streamSimple()` is lazy: it resolves the provider
 * when the stream is first consumed, which is after the credential await, so a
 * mutated collection would let a request that started under one configuration
 * finish under another — or fail with a provider that no longer exists. This is
 * what makes the seam's per-step call freeze (`llm.prepareCall()`) hold all the
 * way down: switching models mid-reply takes effect on the next step, never
 * inside the one in flight.
 *
 * API keys stay outside that collection. The harness resolves a route's key
 * through its own seam and passes it as the request's `apiKey` option, which
 * pi-ai treats as the highest-priority auth override, so the harness keeps its
 * fail-loud reference semantics.
 *
 * Subscription tokens cannot travel that way. They rotate, and the rotation is
 * a read-modify-write pi-ai performs under the store's own lock, so the
 * collection is built over a credential store that reads through to the
 * harness sign-in seam. The store is one stable object built here and shared
 * by every snapshot: the seam may mount after this adapter, and a store
 * captured before that would leave the collection permanently signed out.
 *
 * @module dsh-llm-pi-ai/adapter
 */

import { createModels, getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import type {
  Api,
  Credential,
  CredentialStore,
  Model,
  Models,
  ModelThinkingLevel,
  MutableModels,
  OAuthCredential,
  SimpleStreamOptions,
  ThinkingLevel,
} from '@earendil-works/pi-ai'
import {
  attributionHeaders,
  contentHasImage,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  ReasoningEffortId as ReasoningEffortIdType,
  ResolvedRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { LlmOAuthToken, LlmOAuthTokenStore } from '@deepseek-ai/dsh-llm-oauth'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { ResolvedPiAiProviderProfile } from './config.ts'
import { toPiContext } from './context.ts'
import { toStreamChunks } from './stream.ts'

/** One resolution's frozen view: the profiles and the collection built from them. */
interface PiAiSnapshot {
  /** The resolved profiles this collection was built from, used as its identity. */
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>
  /** Providers for exactly those profiles; never mutated once published. */
  models: Models
}

/**
 * How one request authenticates, decided once per stream call and frozen for
 * it.
 */
export interface PiAiRequestAuth {
  /**
   * API key overriding the route's own auth. Absent defers to that auth, which
   * resolves a stored subscription token first and otherwise falls to the
   * installed catalog route's provider-native ambient discovery.
   */
  apiKey?: string
  /**
   * Whether this request authenticates with a stored subscription token.
   *
   * Anthropic's OAuth path carries its required CLI identity in request
   * headers, so that provider withholds harness attribution. Other providers
   * retain attribution unless their own request implementation replaces it.
   */
  subscription: boolean
}

/** Constructor options for {@link PiAiAdapter}: the resolution hooks the plugin owns. */
export interface PiAiAdapterOptions {
  /** Current validated profiles by provider route; called once per operation. */
  profiles: () => ReadonlyMap<string, ResolvedPiAiProviderProfile>
  /**
   * Decide how one already-resolved profile authenticates its next request;
   * called once per stream call and frozen for that call. The plugin defers to
   * the route's own pi-ai auth only for a profile naming no credential and
   * holding no subscription token, because a named reference that misses
   * throws `LlmError` `MISSING_CREDENTIAL` rather than falling back.
   */
  resolveAuth: (provider: string, profile: ResolvedPiAiProviderProfile) => Promise<PiAiRequestAuth>
  /**
   * The subscription token store backing this adapter's requests, resolved at
   * each call so a sign-in seam mounting after the adapter still reaches it.
   * Omission — and a call answering `undefined` — leaves every route
   * api-key-only.
   */
  resolveTokens?: () => LlmOAuthTokenStore | undefined
  /** Resolve the optional durable attachment service at request time. */
  resolveAttachments?: () => AttachmentStore | undefined
  /**
   * Observe one assistant history message degrading to provider-neutral
   * conversion because its stored replay state is unusable by this build.
   */
  onReplayDegrade?: (detail: { provider: string; model: string; reason: string }) => void
}

/** Copy profile stream knobs into pi-ai's common option vocabulary. */
function profileOptions(
  profile: ResolvedPiAiProviderProfile,
  reasoning: ModelThinkingLevel | undefined,
  apiKey: string | undefined,
): SimpleStreamOptions {
  const enabledReasoning: ThinkingLevel | undefined = reasoning === 'off' ? undefined : reasoning
  return {
    ...apiKey === undefined ? {} : { apiKey },
    ...enabledReasoning === undefined ? {} : { reasoning: enabledReasoning },
    ...profile.thinkingBudgets === undefined ? {} : { thinkingBudgets: profile.thinkingBudgets },
    ...profile.cacheRetention === undefined ? {} : { cacheRetention: profile.cacheRetention },
    ...profile.transport === undefined ? {} : { transport: profile.transport },
    ...profile.timeoutMs === undefined ? {} : { timeoutMs: profile.timeoutMs },
    ...profile.websocketConnectTimeoutMs === undefined ? {} : { websocketConnectTimeoutMs: profile.websocketConnectTimeoutMs },
    // The agent recovery layer owns visible attempts; one adapter call is one SDK attempt.
    maxRetries: 0,
  }
}

/**
 * The profile default this exact model can actually take, for DESCRIBING it.
 * A configured level the model does not support yields none rather than
 * throwing: `resolveModel` builds the model catalog, and a catalog that fails
 * takes its whole provider out of every picker — so one mis-set profile field
 * would hide every model on the route, including the ones that support the
 * level. The request path still refuses, which is where a bad configuration
 * belongs: describing what a model can do must not fail because a deployment
 * asked it for something it cannot.
 * @param model - the resolved model descriptor.
 * @param effort - the profile's configured level, if any.
 * @returns the level when this model supports it, otherwise undefined.
 */
function describableReasoningLevel(
  model: Model<Api>,
  effort: ReasoningEffortIdType | ModelThinkingLevel | undefined,
): ModelThinkingLevel | undefined {
  if (effort === undefined) return undefined
  return getSupportedThinkingLevels(model).some(level => level === effort)
    ? effort as ModelThinkingLevel
    : undefined
}

/** Validate an explicit Harness/profile effort without invoking pi-ai's clamp. */
function resolveReasoningLevel(
  model: Model<Api>,
  effort: ReasoningEffortIdType | ModelThinkingLevel | undefined,
): ModelThinkingLevel | undefined {
  if (effort === undefined) return undefined
  const supported = getSupportedThinkingLevels(model)
  if (supported.some(level => level === effort)) return effort as ModelThinkingLevel
  throw new LlmError(
    `pi-ai provider "${model.provider}" model "${model.id}" does not support reasoning effort "${effort}"`,
    'UNSUPPORTED_REASONING_EFFORT',
  )
}

/**
 * Selectable reasoning efforts for one model, or nothing at all.
 *
 * A model that carries no reasoning metadata — every hand-declared one, and
 * every catalog model pi-ai marks as non-reasoning — is reported by pi-ai as
 * supporting the single level `off`. Passing that through would offer a control
 * that cannot do what it says: `off` is translated to *omitting* the reasoning
 * option, which for such a model is byte-for-byte the same request as naming no
 * effort — so a provider whose own default is to think would keep thinking with
 * `off` selected. Omitting `reasoning` entirely is the seam's way of saying the
 * capability is unavailable, which leaves the surface offering only the
 * provider's default.
 * @param model - the resolved model descriptor.
 * @param defaultLevel - the profile's configured effort, already validated.
 * @returns the `reasoning` field, or an empty object when none can be offered.
 */
function reasoningInfo(
  model: Model<Api>,
  defaultLevel: ModelThinkingLevel | undefined,
): Pick<LlmResolvedModelInfo, 'reasoning'> | Record<string, never> {
  if (!model.reasoning) return {}
  const levels = getSupportedThinkingLevels(model)
  return {
    reasoning: {
      efforts: levels.map(level => ({
        id: ReasoningEffortId(level),
        name: `${level.charAt(0).toUpperCase()}${level.slice(1)}`,
      })),
      ...defaultLevel === undefined ? {} : { defaultEffort: ReasoningEffortId(defaultLevel) },
    },
  }
}

/**
 * The request headers one call sends.
 *
 * Requests merge deployment headers under harness attribution, which wins
 * case-insensitive collisions. Anthropic subscription requests send deployment
 * headers alone because its OAuth path supplies a CLI user agent that the
 * endpoint requires and harness attribution would replace.
 * @param headers - the profile's deployment headers, when any.
 * @param provider - provider route receiving the request.
 * @param subscription - whether the call authenticates with a stored subscription token.
 * @returns the headers to send with the request.
 */
function requestHeaders(
  headers: Readonly<Record<string, string>> | undefined,
  provider: string,
  subscription: boolean,
): Record<string, string> {
  if (subscription && provider === 'anthropic') return { ...headers }
  const attribution = attributionHeaders()
  const reserved = new Set(Object.keys(attribution).map(name => name.toLowerCase()))
  return {
    ...Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase()))),
    ...attribution,
  }
}

/**
 * Read one pi-ai credential as a subscription token set.
 *
 * pi-ai writes back exactly what its OAuth refresh returned, so anything else
 * arriving here means the collection was handed a credential kind this store
 * does not hold. That is a process boundary — the value crossed out of the
 * vendor SDK — and refusing it keeps an api-key credential from being written
 * into the subscription document under a route's key.
 * @param credential - the credential pi-ai asked to store.
 * @returns the token set to store.
 * @throws {LlmError} code `UNSUPPORTED_CREDENTIAL` when the credential is not an OAuth one.
 */
function toStoredToken(credential: Credential): LlmOAuthToken {
  if (credential.type !== 'oauth') {
    throw new LlmError(
      `llm-pi-ai: the subscription token store was handed a "${credential.type}" credential`,
      'UNSUPPORTED_CREDENTIAL',
    )
  }
  const { type: _type, access, refresh, expires, ...extra } = credential
  return { access, refresh, expires, ...Object.keys(extra).length === 0 ? {} : { extra } }
}

/**
 * Render a stored token set as the pi-ai credential its auth resolution reads.
 * @param token - the stored token set, or `undefined` while the route is signed out.
 * @returns the pi-ai credential, or `undefined`.
 */
function toPiCredential(token: LlmOAuthToken | undefined): OAuthCredential | undefined {
  if (token === undefined) return undefined
  return { ...token.extra, type: 'oauth', access: token.access, refresh: token.refresh, expires: token.expires }
}

/**
 * A pi-ai credential store reading through to the harness sign-in seam.
 *
 * The indirection is what lets one store object serve every snapshot: the seam
 * is resolved per operation, so a sign-in service mounting after this adapter
 * still reaches the collection, and one disposing leaves it signed out rather
 * than holding a store nothing backs. A route the harness authenticates with
 * an api key never reaches this store at all — the request's `apiKey` override
 * is resolved before pi-ai consults it.
 * @param resolveTokens - reads the current token store, when a seam supplies one.
 * @returns the credential store to build the `Models` collection with.
 */
function subscriptionCredentialStore(
  resolveTokens: () => LlmOAuthTokenStore | undefined,
): CredentialStore {
  return {
    read: async provider => toPiCredential(await resolveTokens()?.read(provider)),
    list: async () => (await resolveTokens()?.list() ?? [])
      .map(providerId => ({ providerId, type: 'oauth' as const })),
    modify: async (provider, fn) => {
      const tokens = resolveTokens()
      // Nothing to serialize against and nothing to write: answering the
      // current value (none) is what "signed out" means to pi-ai, which then
      // reports the provider unconfigured instead of retrying a refresh.
      if (tokens === undefined) return undefined
      const stored = await tokens.modify(provider, async (current) => {
        const next = await fn(toPiCredential(current))
        return next === undefined ? undefined : toStoredToken(next)
      })
      return toPiCredential(stored)
    },
    delete: async (provider) => {
      await resolveTokens()?.delete(provider)
    },
  }
}

/**
 * pi-ai-backed multi-provider adapter. Each operation reads the current
 * profiles, so a configuration change reaches the next request without a
 * restart; model descriptors come from the collection those profiles built.
 */
export class PiAiAdapter extends LlmAdapter {
  private snapshot: PiAiSnapshot | undefined
  /** One store for every snapshot; see the module contract above. */
  private readonly credentials: CredentialStore

  constructor(private readonly config: PiAiAdapterOptions) {
    super()
    this.credentials = subscriptionCredentialStore(() => this.config.resolveTokens?.())
  }

  /**
   * The snapshot for the current profiles. Resolution memoizes its result, so
   * an unchanged configuration is recognized by identity; a changed one gets a
   * brand-new collection, leaving any snapshot an operation already captured
   * untouched for as long as that operation holds it.
   */
  private current(): PiAiSnapshot {
    const profiles = this.config.profiles()
    if (this.snapshot?.profiles === profiles) return this.snapshot
    const models: MutableModels = createModels({ credentials: this.credentials })
    for (const profile of profiles.values()) models.setProvider(profile.piProvider)
    this.snapshot = { profiles, models }
    return this.snapshot
  }

  /** The profile for one route within one snapshot, or the not-owned failure. */
  private profileOf(snapshot: PiAiSnapshot, provider: string): ResolvedPiAiProviderProfile {
    const profile = snapshot.profiles.get(provider)
    if (profile === undefined) {
      throw new LlmError(`pi-ai adapter does not own provider "${provider}"`, 'NO_ADAPTER')
    }
    return profile
  }

  /** The configured descriptor for one exact route/model pair within one snapshot. */
  private modelOf(snapshot: PiAiSnapshot, provider: string, model: string): Model<Api> {
    this.profileOf(snapshot, provider)
    const resolved = snapshot.models.getModel(provider, model)
    if (resolved === undefined) {
      throw new LlmError(`pi-ai provider "${provider}" has no configured model "${model}"`, 'UNKNOWN_MODEL')
    }
    return resolved
  }

  override providerInfo(provider: string): LlmProviderInfo {
    // The configured name, not the route key: `displayName` exists so a
    // deployment can label a route, and a label only the configuration surface
    // reads would leave every selector showing the raw key.
    return { id: provider, name: this.current().profiles.get(provider)?.displayName ?? provider }
  }

  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    return this.current().profiles.get(provider)?.retryPolicy
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve().then(() => {
      const snapshot = this.current()
      this.profileOf(snapshot, provider)
      return snapshot.models.getModels(provider).map(model => ({
        provider,
        id: model.id,
        name: model.name,
        inputModalities: [...model.input],
      }))
    })
  }

  override resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve().then(() => {
      const snapshot = this.current()
      const profile = this.profileOf(snapshot, provider)
      const resolvedModel = this.modelOf(snapshot, provider, model)
      const defaultLevel = describableReasoningLevel(resolvedModel, profile.reasoning)
      // Only a cap the deployment configured is a request default; the
      // catalog's `maxTokens` sizes the model and stops there.
      const configuredMaxTokens = profile.configuredMaxTokens.get(model)
      return {
        provider,
        id: model,
        name: resolvedModel.name,
        inputModalities: [...resolvedModel.input],
        context: { contextWindow: resolvedModel.contextWindow },
        ...configuredMaxTokens === undefined ? {} : { defaultMaxTokens: configuredMaxTokens },
        ...reasoningInfo(resolvedModel, defaultLevel),
      }
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.stop !== undefined) {
      throw new LlmError('llm-pi-ai does not support GenerateOptions.stop', 'UNSUPPORTED_OPTION')
    }
    // One capture per stream call, taken before any await: the profile, the
    // model descriptor, and the collection all come from the same immutable
    // snapshot, and the credential freezes with them. A configuration change
    // mid-request builds a separate snapshot, so this request finishes under
    // the one it started with and the next call picks up the new one.
    const snapshot = this.current()
    const profile = this.profileOf(snapshot, options.provider)
    const model = this.modelOf(snapshot, options.provider, options.model)
    const reasoning = resolveReasoningLevel(
      model,
      options.reasoningEffort ?? profile.reasoning,
    )
    const auth = await this.config.resolveAuth(options.provider, profile)

    const consumer = new AbortController()
    const upstream = options.signal === undefined
      ? consumer.signal
      : AbortSignal.any([options.signal, consumer.signal])
    const streamIdleTimeoutMs = profile.streamIdleTimeoutMs
    using watchdog = idleWatchdog(upstream, streamIdleTimeoutMs, 'LLM_STREAM_IDLE_TIMEOUT')

    try {
      const containsImage = options.messages.some(message => contentHasImage(message.content))
      if (containsImage && !model.input.includes('image')) {
        throw new LlmError(`pi-ai model "${model.id}" does not support image input`, 'UNSUPPORTED_CONTENT')
      }
      const attachments = containsImage ? this.config.resolveAttachments?.() : undefined
      if (containsImage && attachments === undefined) {
        throw new LlmError('pi-ai image input requires the durable attachment service', 'UNSUPPORTED_CONTENT')
      }
      const onReplayDegrade = (reason: string): void => {
        this.config.onReplayDegrade?.({ provider: options.provider, model: options.model, reason })
      }
      const context = attachments === undefined
        ? toPiContext(options, undefined, onReplayDegrade)
        : await toPiContext(options, attachments, onReplayDegrade)
      const events = snapshot.models.streamSimple(model, context, {
        ...profileOptions(profile, reasoning, auth.apiKey),
        ...options.temperature === undefined ? {} : { temperature: options.temperature },
        ...options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens },
        ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
        signal: watchdog.signal,
        // Profile headers are deployment-owned; attribution names are
        // Harness-owned and therefore win collisions, except where a provider's
        // OAuth endpoint requires its own client identity.
        headers: requestHeaders(profile.headers, options.provider, auth.subscription),
      })
      const iterator = toStreamChunks(events, model.contextWindow, options.signal)[Symbol.asyncIterator]()
      let exhausted = false
      try {
        while (true) {
          const result = await watchdog.next(iterator)
          const timeout = timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT')
          if (timeout !== undefined) throw timeout
          if (result.done) {
            exhausted = true
            return
          }
          yield result.value
        }
      } finally {
        if (!exhausted) {
          consumer.abort('pi-ai stream consumer stopped')
          try {
            await iterator.return(undefined)
          } catch (_abortedSdkTeardown) {
            // The stable signal already owns SDK termination; return-time abort cannot add an outcome.
          }
        }
      }
    } catch (error: unknown) {
      if (timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT') !== undefined) {
        throw new LlmError(`pi-ai stream idle timeout after ${streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: error })
      }
      if (options.signal?.aborted) {
        throw new LlmError('pi-ai request aborted by caller', 'ABORTED', { cause: error })
      }
      throw error
    } finally {
      consumer.abort('pi-ai stream consumer stopped')
    }
  }
}
