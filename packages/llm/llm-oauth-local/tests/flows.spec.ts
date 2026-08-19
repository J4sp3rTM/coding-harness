import { describe, expect, it, vi } from 'vitest'
import { LlmOAuthError } from '@deepseek-ai/dsh-llm-oauth'
import type { LlmOAuthEvent, LlmOAuthPrompt } from '@deepseek-ai/dsh-llm-oauth'
import { oauthFlow, oauthFlows, toPiCredential, toPiInteraction, toSeamToken } from '../src/flows.ts'

describe('oauthFlows', () => {
  it('offers the installed catalog routes that declare a subscription sign-in', () => {
    const flows = oauthFlows()
    expect(flows.get('anthropic')?.loginLabel).toBe('Anthropic (Claude Pro/Max)')
    expect(flows.get('openai-codex')?.loginLabel).toBe('OpenAI (ChatGPT Plus/Pro)')
    // A route with an api key and no OAuth method is not a sign-in route.
    expect(flows.has('deepseek')).toBe(false)
  })

  it('names the offered routes when asked for one that cannot be signed into', () => {
    expect(() => oauthFlow('deepseek')).toThrow(LlmOAuthError)
    try {
      oauthFlow('deepseek')
    } catch (error) {
      expect((error as LlmOAuthError).code).toBe('UNKNOWN_PROVIDER')
      expect((error as Error).message).toContain('anthropic')
    }
  })
})

describe('toPiInteraction', () => {
  it('translates each flow event into the seam vocabulary', () => {
    const seen: LlmOAuthEvent[] = []
    const piInteraction = toPiInteraction({
      notify: event => seen.push(event),
      prompt: () => Promise.resolve(''),
    }, () => {})
    piInteraction.notify({ type: 'auth_url', url: 'https://example.test/a', instructions: 'open it' })
    piInteraction.notify({ type: 'auth_url', url: 'https://example.test/b' })
    piInteraction.notify({ type: 'device_code', userCode: 'ABCD', verificationUri: 'https://example.test/d', intervalSeconds: 5, expiresInSeconds: 600 })
    piInteraction.notify({ type: 'device_code', userCode: 'EFGH', verificationUri: 'https://example.test/d' })
    piInteraction.notify({ type: 'progress', message: 'exchanging' })
    piInteraction.notify({ type: 'info', message: 'note', links: [{ url: 'https://example.test/h' }] })
    piInteraction.notify({ type: 'info', message: 'bare' })
    expect(seen).toEqual([
      { kind: 'auth-url', url: 'https://example.test/a', instructions: 'open it' },
      { kind: 'auth-url', url: 'https://example.test/b' },
      { kind: 'device-code', userCode: 'ABCD', verificationUri: 'https://example.test/d', intervalSeconds: 5, expiresInSeconds: 600 },
      { kind: 'device-code', userCode: 'EFGH', verificationUri: 'https://example.test/d' },
      { kind: 'progress', message: 'exchanging' },
      { kind: 'info', message: 'note', links: [{ url: 'https://example.test/h' }] },
      { kind: 'info', message: 'bare' },
    ])
  })

  it('contains a surface that fails to render an event', () => {
    const failures: unknown[] = []
    const piInteraction = toPiInteraction({
      notify: () => { throw new Error('no renderer') },
      prompt: () => Promise.resolve(''),
    }, (error) => { failures.push(error) })
    expect(() => { piInteraction.notify({ type: 'progress', message: 'x' }) }).not.toThrow()
    expect(failures).toHaveLength(1)
  })

  it('translates each prompt kind and carries the per-prompt signal', async () => {
    const asked: LlmOAuthPrompt[] = []
    const controller = new AbortController()
    const flowSignal = new AbortController().signal
    const piInteraction = toPiInteraction({
      signal: flowSignal,
      notify: () => {},
      prompt: (prompt) => {
        asked.push(prompt)
        return Promise.resolve('answered')
      },
    }, () => {})
    expect(piInteraction.signal).toBe(flowSignal)
    await piInteraction.prompt({ type: 'text', message: 'name?', placeholder: 'here' })
    await piInteraction.prompt({ type: 'secret', message: 'key?' })
    await piInteraction.prompt({ type: 'manual_code', message: 'paste?', signal: controller.signal })
    await piInteraction.prompt({ type: 'select', message: 'which?', options: [{ id: 'a', label: 'A' }] })
    expect(asked.map(prompt => prompt.kind)).toEqual(['text', 'secret', 'manual-code', 'select'])
    expect(asked[0]).toMatchObject({ placeholder: 'here' })
    expect(asked[2]?.signal).toBe(controller.signal)
  })
})

describe('token translation', () => {
  it('round-trips a credential through the stored token set, keeping provider-owned fields', () => {
    const credential = { type: 'oauth' as const, access: 'a', refresh: 'r', expires: 5, accountId: 'acct' }
    const token = toSeamToken(credential)
    expect(token).toEqual({ access: 'a', refresh: 'r', expires: 5, extra: { accountId: 'acct' } })
    expect(toPiCredential(token)).toEqual(credential)
  })

  it('carries no extra fields when the flow returned none', () => {
    const token = toSeamToken({ type: 'oauth', access: 'a', refresh: 'r', expires: 5 })
    expect(token).toEqual({ access: 'a', refresh: 'r', expires: 5 })
    expect(toPiCredential(token)).toEqual({ type: 'oauth', access: 'a', refresh: 'r', expires: 5 })
  })
})

describe('unknown upstream union members', () => {
  it('renders an added event as progress and asks an added prompt as free text', async () => {
    const seen: LlmOAuthEvent[] = []
    const asked: LlmOAuthPrompt[] = []
    const piInteraction = toPiInteraction({
      notify: event => seen.push(event),
      prompt: (prompt) => {
        asked.push(prompt)
        return Promise.resolve('')
      },
    }, () => {})
    // pi-ai's auth vocabulary is merge-extensible; an upgrade adding a member
    // must degrade rather than fail a sign-in in progress.
    piInteraction.notify({ type: 'future-event' } as never)
    await piInteraction.prompt({ type: 'future-prompt', message: 'new?' } as never)
    expect(seen).toEqual([{ kind: 'progress', message: 'future-event' }])
    expect(asked).toEqual([{ kind: 'text', message: 'new?' }])
  })
})

describe('memoization', () => {
  it('builds the catalog index once', () => {
    const first = oauthFlows()
    expect(oauthFlows()).toBe(first)
    vi.restoreAllMocks()
  })
})
