import { describe, expect, it, vi } from 'vitest'
import type { Api, Model, Provider } from '@earendil-works/pi-ai'
import type { BuiltinProvider } from '@earendil-works/pi-ai/providers/all'

const fixtureModels: Model<Api>[] = [
  {
    id: 'fixture-completions', name: 'Fixture Completions', api: 'openai-completions', provider: 'fixture-mixed',
    baseUrl: 'https://fixture.test', reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 1024,
  },
  {
    id: 'fixture-responses', name: 'Fixture Responses', api: 'openai-responses', provider: 'fixture-mixed',
    baseUrl: 'https://fixture.test', reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 1024,
  },
]

vi.mock('@earendil-works/pi-ai/providers/all', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-ai/providers/all')>()
  const base = actual.builtinProviders().find(provider => provider.id === 'deepseek')
  if (base === undefined) throw new Error('the pi-ai test fixture could not find a provider implementation')
  const fixtureProvider: Provider = { ...base, id: 'fixture-mixed', name: 'Fixture Mixed', getModels: () => fixtureModels }
  return {
    ...actual,
    builtinProviders: () => [...actual.builtinProviders(), fixtureProvider],
    getBuiltinModels: (provider: BuiltinProvider) => (provider as string) === 'fixture-mixed'
      ? fixtureModels
      : actual.getBuiltinModels(provider),
    getBuiltinProviders: () => [...actual.getBuiltinProviders(), 'fixture-mixed'],
  }
})

const { resolveProfiles } = await import('../src/config.ts')

describe('reasoning-dispatch compat switches', () => {
  it('skips models of other protocols on a mixed route instead of failing them', () => {
    const models = resolveProfiles({
      'fixture-mixed': {
        compat: { supportsReasoningEffort: false },
        models: fixtureModels.map(model => ({ id: model.id })),
      },
    }).get('fixture-mixed')?.piProvider.getModels() ?? []

    expect(models.find(model => model.id === 'fixture-completions')?.compat)
      .toMatchObject({ supportsReasoningEffort: false })
    expect(models.find(model => model.id === 'fixture-responses')?.compat).toBeUndefined()
  })
})
