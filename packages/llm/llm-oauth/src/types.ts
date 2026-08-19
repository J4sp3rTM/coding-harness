/**
 * Client-safe type surface of the subscription sign-in seam: the account and
 * interaction vocabulary, plus the seam's Cordis event declaration. Types only
 * — no runtime code, and nothing here reaches a Host-only symbol, so a Client
 * compilation face reads exactly the signature the Host emits.
 *
 * @module @deepseek-ai/dsh-llm-oauth/types
 */

/** One provider route a subscription sign-in can authenticate. */
export interface LlmOAuthProviderInfo {
  /** Provider route key, the same key the LLM adapter registers and settings address. */
  provider: string
  /** Name shown by sign-in surfaces; defaults to the route key. */
  displayName: string
  /** Label for the sign-in action, e.g. `Sign in with Claude Pro/Max`. */
  loginLabel: string
}

/**
 * Non-secret sign-in facts for one route, safe for status surfaces and the
 * session log — never a token. `expiresAt` describes the stored access token,
 * not the session: an expired access token beside a stored refresh token is
 * still `signedIn`, because the next request rotates it.
 */
export interface LlmOAuthAccount extends LlmOAuthProviderInfo {
  /** Whether a token set is stored for this route. */
  signedIn: boolean
  /** Epoch milliseconds the stored access token stops being usable; absent while signed out. */
  expiresAt?: number
}

/** A link a sign-in surface may render beside an informational message. */
export interface LlmOAuthLink {
  /** Absolute URL. */
  url: string
  /** Link text; surfaces that cannot render a label show the URL. */
  label?: string
}

/**
 * One step a sign-in flow reports while it runs. A surface that does not know
 * a member renders nothing for it; the flow never depends on a member being
 * displayed, because every input it actually needs arrives through
 * {@link LlmOAuthPrompt}.
 */
export type LlmOAuthEvent =
  | {
    kind: 'auth-url'
    /** Authorization URL the human must open. */
    url: string
    /** What to do there, when the flow has more to say than "open this". */
    instructions?: string
  }
  | {
    kind: 'device-code'
    /** Code the human types at {@link verificationUri}. */
    userCode: string
    /** Page where the code is entered. */
    verificationUri: string
    /** Provider-requested poll interval in seconds. */
    intervalSeconds?: number
    /** Seconds until the code stops being accepted. */
    expiresInSeconds?: number
  }
  | { kind: 'progress'; message: string }
  | { kind: 'info'; message: string; links?: readonly LlmOAuthLink[] }

/** One option a `select` prompt offers. */
export interface LlmOAuthPromptOption {
  /** Value the interaction returns when this option is chosen. */
  id: string
  /** Text shown for the option. */
  label: string
  /** Supporting text a surface may render beside the label. */
  description?: string
}

/**
 * One question a sign-in flow asks the human. `manual-code` is the
 * paste-the-redirect fallback raced against a loopback callback: the flow
 * aborts it through {@link signal} when the callback wins, so a surface MUST
 * settle a prompt whose signal aborts instead of leaving it pending.
 */
export type LlmOAuthPrompt = {
  /** Aborts this one prompt when the flow no longer needs its answer. */
  signal?: AbortSignal
} & (
  | { kind: 'text'; message: string; placeholder?: string }
  | { kind: 'secret'; message: string; placeholder?: string }
  | { kind: 'manual-code'; message: string; placeholder?: string }
  | { kind: 'select'; message: string; options: readonly LlmOAuthPromptOption[] }
)

/**
 * The surface a sign-in flow talks to. `prompt` resolves with the entered text
 * — a `select` resolves with the chosen option's `id` — and rejects when the
 * human cancels or a signal aborts.
 */
export interface LlmOAuthInteraction {
  /** Aborts the whole flow; per-question cancellation uses {@link LlmOAuthPrompt.signal}. */
  signal?: AbortSignal
  /**
   * Ask the human one question.
   * @param prompt - the question to ask.
   * @returns the entered text, or the chosen option's id.
   */
  prompt(prompt: LlmOAuthPrompt): Promise<string>
  /**
   * Report one step of the flow. Never awaited: a surface that cannot render
   * an event drops it rather than stalling the flow.
   * @param event - the step being reported.
   */
  notify(event: LlmOAuthEvent): void
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Committed change to a stored subscription token set: a completed sign-in,
     * a sign-out, or a rotation observed in storage. Listener failures are
     * contained and logged — a sync throw and an async rejection alike —
     * without changing the committed operation's outcome, except
     * `INVARIANT`-coded failures, which rethrow after every listener ran; that
     * rethrow reaches the emitter only from synchronous listeners, so invariant
     * checks on this event must not be async functions.
     * @param provider - the provider route whose stored token set changed.
     * @mode emit
     */
    'llm-oauth/updated'(provider: string): void
  }
}
