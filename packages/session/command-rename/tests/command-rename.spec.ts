// /rename pins one explicit session title through the session-title service.
// Covers the usage guard (blank and bare invocations), the normalized success
// path with its durable user-source `session/title` event and reported seq,
// the input-blaming rejection mapping, and propagation of unexpected failures.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { CommandId } from '@deepseek-ai/dsh-commands'
import type { CommandDefinition, CommandResult } from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import {
  SessionTitleInvalidError,
  type SessionTitleSnapshot,
} from '@deepseek-ai/dsh-session-title'
import * as CommandRename from '../src/index.ts'

const MODEL = 'mock'

/** Title limits matching the session-title service's own rename tests. */
const TITLE_CONFIG = {
  fallbackMaxWords: 5,
  fallbackMaxBytes: 40,
  maxTitleBytes: 40,
} as const

interface Harness {
  ctx: Context
  agent: Agent
  plugin: Awaited<ReturnType<Context['plugin']>>
  run: (line: string) => Promise<CommandResult | undefined>
}

/** Real agent loop, session store, title service, command registry, and /rename. */
async function boot(): Promise<Harness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SessionTitleService, TITLE_CONFIG)
  await ctx.plugin(CommandRuntime)
  const plugin = await ctx.plugin(CommandRename)
  const agent = ctx.agentLoop.create(SessionId('rename-agent'), { provider: MODEL, model: MODEL })
  const run = async (line: string): Promise<CommandResult | undefined> =>
    (await ctx.commands.execute(agent, line, new AbortController().signal))?.result
  return { ctx, agent, plugin, run }
}

/** The latest durable title event pinned by an explicit user rename. */
function userTitleEvent(agent: Agent) {
  return agent.session.events.findLast(item =>
    item.type === 'session/title' && item.data.source.kind === 'user')
}

/** Resolve the registered /rename definition or fail the test loud. */
function renameDefinition(ctx: Context, agent: Agent): CommandDefinition {
  const definition = ctx.commands.find(agent, 'rename')
  if (definition === undefined) throw new Error('the /rename command was not registered')
  return definition
}

describe('/rename', () => {
  it('pins the normalized title and reports the durable title event', async () => {
    const { ctx, agent, run } = await boot()
    // Extra internal whitespace is collapsed by the service's normalization:
    // the acknowledged text must quote the snapshot title, not the raw input.
    const result = await run('/rename   Hand   picked\tname ')
    expect(result).toMatchObject({ kind: 'success' })
    expect(result?.text).toContain('Hand picked name')
    expect(result?.text).not.toContain('Hand   picked')
    const event = userTitleEvent(agent)
    expect(event?.data).toMatchObject({
      title: 'Hand picked name',
      messageSeqs: [],
      source: { kind: 'user' },
    })
    expect(result?.kind === 'success' ? result.sourceEventSeq : undefined).toBe(event?.seq)
    expect(ctx.sessionTitle.get(agent.session)?.title).toBe('Hand picked name')
  })

  it('rejects a whitespace-only title with the exact usage text', async () => {
    const { agent, run } = await boot()
    const result = await run('/rename   ')
    expect(result).toEqual({ kind: 'error', text: 'Usage: /rename <new title>' })
    expect(agent.session.events.some(item => item.type === 'session/title')).toBe(false)
  })

  it('rejects a bare invocation with the exact usage text', async () => {
    const { agent, run } = await boot()
    const result = await run('/rename')
    expect(result).toEqual({ kind: 'error', text: 'Usage: /rename <new title>' })
    expect(userTitleEvent(agent)).toBeUndefined()
  })

  it('maps a visible-but-empty normalized title onto the service rejection', async () => {
    const { agent, run } = await boot()
    // An ANSI color code passes this package's trim yet carries no visible
    // characters, which is exactly the service's SessionTitleInvalidError.
    const result = await run('/rename \u001B[31m')
    expect(result).toEqual({ kind: 'error', text: 'session title must contain visible characters' })
    expect(agent.session.events.some(item => item.type === 'session/title')).toBe(false)
  })

  it('surfaces a rejecting stub service through a direct handler call', async () => {
    const { ctx, agent } = await boot()
    const handler = renameDefinition(ctx, agent).handler
    const original = ctx.sessionTitle.rename.bind(ctx.sessionTitle)
    ctx.sessionTitle.rename = (): SessionTitleSnapshot => {
      throw new SessionTitleInvalidError('rejected by the stub')
    }
    try {
      const result = await handler({
        commandId: CommandId('stub-run'),
        agent,
        rawInput: 'Visible Title',
        signal: new AbortController().signal,
      })
      expect(result).toEqual({ kind: 'error', text: 'rejected by the stub' })
    } finally {
      ctx.sessionTitle.rename = original
    }
  })

  it('propagates unexpected service failures to the registry renderer', async () => {
    const { ctx, agent } = await boot()
    const handler = renameDefinition(ctx, agent).handler
    const original = ctx.sessionTitle.rename.bind(ctx.sessionTitle)
    ctx.sessionTitle.rename = (): SessionTitleSnapshot => {
      throw new Error('session-title service disposed')
    }
    try {
      expect(() => handler({
        commandId: CommandId('stub-failure'),
        agent,
        rawInput: 'Visible Title',
        signal: new AbortController().signal,
      })).toThrow('session-title service disposed')
    } finally {
      ctx.sessionTitle.rename = original
    }
  })

  it('unregisters on plugin disposal (HMR safety)', async () => {
    const { ctx, agent, plugin } = await boot()
    expect(ctx.commands.find(agent, 'rename')).toBeDefined()
    await plugin.dispose()
    expect(ctx.commands.find(agent, 'rename')).toBeUndefined()
  })
})
