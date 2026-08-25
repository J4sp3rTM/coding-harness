import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import GoalService from '@deepseek-ai/dsh-goal'
import LlmRuntime, { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import * as LlmRetry from '@deepseek-ai/dsh-llm-retry'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as GoalRoundDriver from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

class GoalFallbackAdapter extends LlmAdapter {
  requests = 0

  override async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests += 1
    if (this.requests <= 2) throw new LlmError('pi transport failed', 'PI_AI_ERROR')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'goal recovered' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'goal recovered' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-goal-retry-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-llm-retry'",
    "- name: '@deepseek-ai/dsh-goal'",
    "- name: '@deepseek-ai/dsh-goal-round-driver'",
    '  config:',
    '    transientRetry:',
    '      backoff:',
    '        initialDelayMs: 1',
    '        maxDelayMs: 1',
    '        jitterRatio: 0',
    "- name: '@deepseek-ai/dsh-agent-loop'",
    '  config:',
    '    agents: []',
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-llm-retry', LlmRetry],
    ['@deepseek-ai/dsh-goal', GoalService],
    ['@deepseek-ai/dsh-goal-round-driver', GoalRoundDriver],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  it('recovers a PI error through the loaded goal fallback contribution', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const adapter = new GoalFallbackAdapter()
    loaded.llm.registerAdapter(['mock'], adapter)
    const agent = loaded.agentLoop.create(SessionId('loader-goal-retry'), { provider: 'mock', model: 'mock' })

    loaded.goals.create(agent, { objective: 'recover the loaded goal', maxGoalRounds: 1 })
    await vi.waitFor(() => {
      expect(loaded.goals.get(agent)?.phase).toBe('blocked')
    })
    await agent.whenIdle()

    expect(adapter.requests).toBe(3)
    expect(loaded.goals.get(agent)).toMatchObject({ phase: 'blocked', roundsStarted: 1 })
    expect(agent.session.events.filter(event => event.type === 'llm/retry').map(event => event.data.policyKey))
      .toEqual([
        '["contribution","goal-round-driver","always",1,1,0]',
        '["contribution","goal-round-driver","always",1,1,0]',
      ])
  })
})
