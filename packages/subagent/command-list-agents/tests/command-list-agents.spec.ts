import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime, { CommandId } from '@deepseek-ai/dsh-commands'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, { SUBAGENT_DESCRIPTOR_VERSION } from '@deepseek-ai/dsh-subagent'
import type { SubagentListEntry } from '@deepseek-ai/dsh-subagent'
import * as commandListAgents from '../src/index.ts'

const EMPTY_TEXT = 'No subagents have been started from this session.'
const CANCELLED_TEXT = 'Subagent lookup cancelled.'

interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

/** Build a live idle agent accepted by the command executor's exact-identity surfaces. */
function stubAgent(ctx: Context, id: string): Agent {
  // Store-created: the command executor durably logs lifecycle events on it.
  const session = ctx.sessions.create(SessionId(id))
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return agent
}

/** Mount the real command registry, projection registry, subagent runtime, and the command under test. */
async function boot(): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  const plugin = await ctx.plugin(commandListAgents)
  const agent = stubAgent(ctx, 'list-agents-parent')
  ctx.agents.register(agent)
  return { ctx, agent, plugin }
}

/** Execute one slash line through the same registry boundary as a UI adapter. */
async function run(test: Harness, line = '/list-agents'): Promise<CommandResult | undefined> {
  const execution = await test.ctx.commands.execute(test.agent, line, new AbortController().signal)
  return execution?.result
}

/** The registered `/list-agents` handler for direct invocation tests. */
function handlerOf(test: Harness): NonNullable<ReturnType<CommandRuntime['find']>>['handler'] {
  const handler = test.ctx.commands.find(test.agent, 'list-agents')?.handler
  if (handler === undefined) throw new Error('/list-agents was not registered')
  return handler
}

/** One valid continuable descriptor payload as the identity projection folds it. */
function descriptorPayload(label: string) {
  return { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable' as const, provider: 'spawn', label }
}

/** Publish one live child session with an appended descriptor straight through the store. */
function publishLiveChild(ctx: Context, parentId: SessionId, id: string, label: string): SessionId {
  const child = ctx.sessions.create(SessionId(id), {
    meta: { parentSession: parentId, origin: 'subagent' },
  })
  child.append('turn/start', { turn: 1 })
  child.append('subagent/descriptor', descriptorPayload(label))
  return child.header.id
}

describe('@deepseek-ai/dsh-command-list-agents registration', () => {
  it('registers one global command with Loader-safe exports and disposes it', async () => {
    const test = await boot()
    expect(commandListAgents.name).toBe('command-list-agents')
    expect(commandListAgents.inject).toEqual(['commands', 'subagents'])
    expect('default' in commandListAgents).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(commandListAgents)).toBe(commandListAgents)

    expect(test.ctx.commands.list(test.agent)).toContainEqual({
      name: 'list-agents',
      description: 'List this session\u2019s subagents',
    })

    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.agent, 'list-agents')).toBeUndefined()
  })

  it('unregisters before disposal waits for an already-started listing', async () => {
    const test = await boot()
    const pending = Promise.withResolvers<SubagentListEntry[]>()
    const original = test.ctx.subagents.listChildren.bind(test.ctx.subagents)
    test.ctx.subagents.listChildren = () => pending.promise
    const operation = handlerOf(test)({
      commandId: CommandId('pending-list'),
      agent: test.agent,
      rawInput: '',
      signal: new AbortController().signal,
    })
    let disposed = false
    const disposal = test.plugin.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(test.ctx.commands.find(test.agent, 'list-agents')).toBeUndefined()
    expect(disposed).toBe(false)
    pending.resolve([])
    await expect(operation).resolves.toEqual({ kind: 'success', text: EMPTY_TEXT })
    await disposal
    expect(disposed).toBe(true)
    test.ctx.subagents.listChildren = original
  })
})

describe('renderAgents', () => {
  it('renders a labeled running continuable child with its descendant hint', () => {
    const entries: SubagentListEntry[] = [{
      kind: 'child',
      id: SessionId('child-1'),
      label: 'researcher',
      mode: 'continuable',
      activity: 'running',
      hasChildren: true,
    }]
    expect(commandListAgents.renderAgents(entries)).toBe('• researcher — continuable, running, has subagents')
  })

  it('falls back to the durable id for an unlabeled one-shot child and shows labels when present', () => {
    const unlabeled: SubagentListEntry[] = [{
      kind: 'child',
      id: SessionId('abc-123'),
      mode: 'one-shot',
      activity: 'inactive',
      hasChildren: false,
    }]
    expect(commandListAgents.renderAgents(unlabeled)).toBe('• abc-123 — one-shot, inactive')

    const labeled: SubagentListEntry[] = [{
      kind: 'child',
      id: SessionId('abc-123'),
      mode: 'one-shot',
      label: 'one-shot errand',
      activity: 'inactive',
      hasChildren: false,
    }]
    expect(commandListAgents.renderAgents(labeled)).toBe('• one-shot errand — one-shot, inactive')
  })

  it('renders every diagnostic reason as its own unavailable row', () => {
    const corrupt: SubagentListEntry[] = [
      { kind: 'diagnostic', id: SessionId('diag-1'), reason: 'corrupt' },
    ]
    expect(commandListAgents.renderAgents(corrupt)).toBe('• diag-1 — unavailable (corrupt)')

    const unavailable: SubagentListEntry[] = [
      { kind: 'diagnostic', id: SessionId('diag-2'), reason: 'unavailable' },
    ]
    expect(commandListAgents.renderAgents(unavailable)).toBe('• diag-2 — unavailable (unavailable)')
  })

  it('keeps the runtime order across mixed rows and joins them by newline', () => {
    const entries: SubagentListEntry[] = [
      { kind: 'diagnostic', id: SessionId('diag-9'), reason: 'unavailable' },
      {
        kind: 'child',
        id: SessionId('child-2'),
        label: 'writer',
        mode: 'continuable',
        activity: 'inactive',
        hasChildren: false,
      },
      {
        kind: 'child',
        id: SessionId('child-3'),
        mode: 'one-shot',
        activity: 'running',
        hasChildren: true,
      },
    ]
    expect(commandListAgents.renderAgents(entries)).toBe(
      '• diag-9 — unavailable (unavailable)\n'
      + '• writer — continuable, inactive\n'
      + '• child-3 — one-shot, running, has subagents',
    )
  })

  it('returns the fixed empty-catalog sentence without any row', () => {
    expect(commandListAgents.renderAgents([])).toBe(EMPTY_TEXT)
  })
})

describe('/list-agents through the real subagent runtime', () => {
  it('reports the empty-catalog sentence on a session without subagents', async () => {
    const test = await boot()
    await expect(run(test)).resolves.toEqual({ kind: 'success', text: EMPTY_TEXT })
  })

  it('tolerates stray arguments because the listing takes none', async () => {
    const test = await boot()
    await expect(run(test, '/list-agents not an argument')).resolves.toEqual({
      kind: 'success',
      text: EMPTY_TEXT,
    })
  })

  it('renders a live child row served by the real listing', async () => {
    const test = await boot()
    publishLiveChild(test.ctx, test.agent.id, 'live-child', 'researcher')
    await expect(run(test)).resolves.toEqual({
      kind: 'success',
      text: '• researcher — continuable, running',
    })
  })
})

describe('/list-agents cancellation and failure mapping', () => {
  it('maps an aborted listing to the stable cancelled result via a direct handler call', async () => {
    const test = await boot()
    const controller = new AbortController()
    controller.abort(new Error('stop now'))
    const spy = vi.spyOn(test.ctx.subagents, 'listChildren').mockImplementation(
      (_parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentListEntry[]> => {
        const failure = signal?.reason instanceof Error ? signal.reason : new Error('listing aborted')
        return Promise.reject(failure)
      },
    )
    const result = await handlerOf(test)({
      commandId: CommandId('cmd-direct-cancelled'),
      agent: test.agent,
      rawInput: '',
      signal: controller.signal,
    })
    expect(result).toEqual({ kind: 'error', text: CANCELLED_TEXT })
    expect(spy).toHaveBeenCalledWith(test.agent.id, controller.signal)
  })

  it('rethrows a listing failure that is not an abort', async () => {
    const test = await boot()
    vi.spyOn(test.ctx.subagents, 'listChildren').mockRejectedValue(new Error('projection registry missing'))
    await expect(handlerOf(test)({
      commandId: CommandId('cmd-direct-failed'),
      agent: test.agent,
      rawInput: '',
      signal: new AbortController().signal,
    })).rejects.toThrow('projection registry missing')
  })
})
