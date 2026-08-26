import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult, type ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import { WorkflowEngine, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type { WorkflowResult, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import * as developmentWorkflow from '../src/index.ts'
import * as developmentWorkflowSettings from '../src/settings.ts'
import { isTinyNonRepetitive, legacyRouteTier, routeTier, shouldDelegate } from '../src/route.ts'

class TestSettings extends SettingsProvider {
  private readonly testDocument: Record<string, unknown> = {}
  override get writable(): boolean { return true }
  protected override load(): Promise<Record<string, unknown>> { return Promise.resolve(structuredClone(this.testDocument)) }
  protected override persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.testDocument[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

class StubEngine extends WorkflowEngine {
  requests: WorkflowStartRequest[] = []
  disposed = 0
  cancelled: string[] = []
  steers: string[] = []
  settle!: (result: WorkflowResult) => void
  startError: Error | undefined
  lastId!: WorkflowRunId
  disposeCompleted = false

  start(request: WorkflowStartRequest) {
    if (this.startError !== undefined) throw this.startError
    this.requests.push(request)
    const result = new Promise<WorkflowResult>((resolve) => { this.settle = resolve })
    this.lastId = WorkflowRunId(`development-${this.requests.length}`)
    return {
      id: this.lastId,
      meta: request.meta,
      result,
      cancel: (reason?: string) => {
        this.cancelled.push(reason ?? 'cancelled')
        this.settle({ value: null, stopReason: 'cancelled', ...reason === undefined ? {} : { error: reason }, agentsStarted: 0 })
      },
      steer: (text: string) => { this.steers.push(text); return true },
      dispose: async () => { this.disposed += 1; this.disposeCompleted = true },
    }
  }

  agentStart(id: WorkflowRunId): void {
    this.emitWorkflowEvent('workflow/agent-start', { id, meta: { name: 'development-workflow', description: 'test' } }, { seq: 1, label: 'worker', childId: SessionId('child') })
  }

  agentEnd(id: WorkflowRunId): void {
    this.emitWorkflowEvent('workflow/agent-end', { id, meta: { name: 'development-workflow', description: 'test' } }, { seq: 1, label: 'worker', childId: SessionId('child'), outcome: 'completed' })
  }
}

async function setup(config: developmentWorkflow.Config = {}, tiers?: NonNullable<developmentWorkflowSettings.DevelopmentWorkflowSettings['tiers']>) {
  const ctx = new Context()
  await ctx.plugin(TestSettings)
  await ctx.plugin(developmentWorkflowSettings)
  if (tiers !== undefined) await ctx.settings.update(developmentWorkflowSettings.DEVELOPMENT_WORKFLOW_SETTINGS_NAMESPACE, { tiers })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(StubEngine)
  const fiber = await ctx.plugin(developmentWorkflow, config)
  const session = Session.create(SessionId('parent'))
  const parent = { id: session.id, options: {}, session } as unknown as Agent
  return { ctx, engine: ctx.workflowEngine as StubEngine, fiber, parent, session }
}

function execute(ctx: Context, arguments_: unknown, parent?: Agent, signal = new AbortController().signal): Promise<ToolExecutionResult> {
  return ctx.tools.execute({ name: 'delegate_work', arguments: arguments_, callId: CallId('development-test'), signal, ...parent === undefined ? {} : { agent: parent } })
}

const unit = { id: 'inspect', role: 'inspection' as const, task: 'Inspect the changed files.', complexity: 'ordinary' as const, risk: 'low' as const }

describe('development-workflow routing policy', () => {
  it('does not select T3 for a tiny non-repetitive simple low-risk unit', () => {
    const tiny = { role: 'implementation' as const, complexity: 'simple' as const, risk: 'low' as const, scopes: ['src/greet.js'] }
    expect(routeTier(tiny)).toBe('T2')
    expect(legacyRouteTier(tiny)).toBe('T3')
    expect(isTinyNonRepetitive(tiny)).toBe(true)
    expect(shouldDelegate([tiny])).toBe(false)
  })

  it('selects T3 for repetitive mechanical simple low-risk work', () => {
    const repetitive = { role: 'implementation' as const, complexity: 'simple' as const, risk: 'low' as const, repetitive: true, scopes: ['src/ops.js'] }
    expect(routeTier(repetitive)).toBe('T3')
    expect(shouldDelegate([repetitive])).toBe(true)
  })

  it('selects T2 for ordinary multi-file implementation', () => {
    const medium = { role: 'implementation' as const, complexity: 'ordinary' as const, risk: 'medium' as const, scopes: ['a.js', 'b.js', 'c.js'] }
    expect(routeTier(medium)).toBe('T2')
    expect(shouldDelegate([medium])).toBe(true)
  })

  it('selects T1 for exceptional architecture, diagnosis, or high-value review', () => {
    expect(routeTier({ role: 'review', exceptional: true })).toBe('T1')
    expect(routeTier({ role: 'inspection', exceptional: true, complexity: 'complex', risk: 'high' })).toBe('T1')
    expect(shouldDelegate([{ role: 'review', exceptional: true }])).toBe(true)
  })
})

describe('dsh-tool-development-workflow', () => {
  it('routes by default and starts the fixed workflow with a matching cap', async () => {
    const { ctx, engine, parent } = await setup()
    const pending = execute(ctx, { objective: 'Ship the change.', plan: 'Inspect then validate.', workUnits: [unit] }, parent)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(engine.requests[0]).toMatchObject({ maxTotalAgents: 1, args: { units: [{ tier: 'T2', route: {} }], parallel: false }, parent })
    expect(engine.requests[0]!.args).not.toHaveProperty('maxHandoffChars')
    expect(engine.requests[0]!.script).toContain('structured report')
    expect(engine.requests[0]!.script).toContain('You are read-only: do not edit, create, delete, or format files.')
    expect(engine.requests[0]!.script).toContain('Declared scopes:')
    engine.settle({ value: { objective: 'Ship the change.', reports: [], steering: { applied: [], unapplied: [] } }, stopReason: 'completed', agentsStarted: 1 })
    expect((await pending).isError).toBe(false)
    expect(engine.disposed).toBe(1)
  })

  it('routes all tiers and propagates configured provider/model/effort overrides', async () => {
    const { ctx, engine, parent } = await setup({}, { t1: { provider: 'review-provider', model: 'review-model', reasoningEffort: 'max' }, t2: { provider: 'implementation-provider', model: 'implementation-model', reasoningEffort: 'high' }, t3: { provider: 'repeat-provider', model: 'repeat-model', reasoningEffort: 'medium' } })
    const pending = execute(ctx, { objective: 'x', plan: 'p', workUnits: [
      { id: 'review', role: 'review', task: 'Find concrete defects.', exceptional: true },
      { id: 'implement', role: 'implementation', task: 'Implement the planned change.', complexity: 'complex', risk: 'high' },
      { id: 'repeat', role: 'inspection', task: 'Repeat a low-risk check.', complexity: 'simple', risk: 'low', repetitive: true },
    ] }, parent)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(engine.requests.at(-1)!.args).toMatchObject({ units: [
      { tier: 'T1', route: { provider: 'review-provider', model: 'review-model', reasoningEffort: 'max' } },
      { tier: 'T2', route: { provider: 'implementation-provider', model: 'implementation-model', reasoningEffort: 'high' } },
      { tier: 'T3', route: { provider: 'repeat-provider', model: 'repeat-model', reasoningEffort: 'medium' } },
    ] })
    engine.settle({ value: { objective: 'x', reports: [], steering: { applied: [], unapplied: [] } }, stopReason: 'completed', agentsStarted: 3 })
    await pending
  })

  it('captures live tier settings at call start and applies later edits to the next call', async () => {
    const { ctx, engine, parent } = await setup({}, { t2: { provider: 'first-provider', model: 'first-model' } })
    const first = execute(ctx, { objective: 'x', plan: 'p', workUnits: [unit] }, parent)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(engine.requests[0]!.args).toMatchObject({ units: [{ route: { provider: 'first-provider', model: 'first-model' } }] })
    await ctx.settings.update(developmentWorkflowSettings.DEVELOPMENT_WORKFLOW_SETTINGS_NAMESPACE, { tiers: { t2: { provider: 'second-provider', model: 'second-model' } } })
    expect(engine.requests[0]!.args).toMatchObject({ units: [{ route: { provider: 'first-provider', model: 'first-model' } }] })
    engine.settle({ value: { objective: 'x', reports: [], steering: { applied: [], unapplied: [] } }, stopReason: 'completed', agentsStarted: 1 })
    await first
    const second = execute(ctx, { objective: 'x', plan: 'p', workUnits: [unit] }, parent)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(engine.requests[1]!.args).toMatchObject({ units: [{ route: { provider: 'second-provider', model: 'second-model' } }] })
    engine.settle({ value: { objective: 'x', reports: [], steering: { applied: [], unapplied: [] } }, stopReason: 'completed', agentsStarted: 1 })
    await second
  })

  it('records workflow/member lifecycle and closes the durable run after disposal', async () => {
    const { ctx, engine, parent, session } = await setup()
    const pending = execute(ctx, { objective: 'x', plan: 'p', workUnits: [unit] }, parent)
    await new Promise(resolve => setTimeout(resolve, 0))
    engine.agentStart(engine.lastId)
    engine.agentEnd(engine.lastId)
    engine.settle({ value: { objective: 'x', reports: [], steering: { applied: [], unapplied: [] } }, stopReason: 'completed', agentsStarted: 1 })
    await pending
    expect(engine.disposeCompleted).toBe(true)
    expect(session.events.map(event => event.type)).toEqual([
      'tool-workflow/run-start', 'tool-workflow/agent-start', 'tool-workflow/agent-end', 'tool-workflow/run-end',
    ])
  })

  it('rejects unknown fields, overlapping path scopes, and over-cap unit lists', async () => {
    const { ctx, engine, parent } = await setup()
    expect((await execute(ctx, { objective: 'x', plan: 'p', workUnits: [{ ...unit, extra: true }] }, parent)).isError).toBe(true)
    expect((await execute(ctx, { objective: 'x', plan: 'p', workUnits: [{ ...unit, tier: 'T1' }] }, parent)).isError).toBe(true)
    expect((await execute(ctx, { objective: 'x', plan: 'p', parallel: true, workUnits: [{ ...unit, scopes: ['src'] }, { ...unit, id: 'two', scopes: ['src\\foo'] }] }, parent)).isError).toBe(true)
    expect((await execute(ctx, { objective: 'x', plan: 'p', parallel: true, workUnits: [{ ...unit, scopes: ['./'] }, { ...unit, id: 'two', scopes: ['src'] }] }, parent)).isError).toBe(true)
    expect((await execute(ctx, { objective: 'x', plan: 'p', parallel: true, workUnits: [{ ...unit, scopes: ['src/../src'] }, { ...unit, id: 'two', scopes: ['src'] }] }, parent)).isError).toBe(true)
    const many = Array.from({ length: 9 }, (_, index) => ({ ...unit, id: `unit-${index}` }))
    expect((await execute(ctx, { objective: 'x', plan: 'p', workUnits: many }, parent)).isError).toBe(true)
    expect(engine.requests).toHaveLength(0)
  })

  it('cancels and disposes an in-flight workflow', async () => {
    const { ctx, engine, parent } = await setup()
    const controller = new AbortController()
    const pending = execute(ctx, { objective: 'x', plan: 'p', workUnits: [unit] }, parent, controller.signal)
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort()
    const result = await pending
    expect(result.isError).toBe(true)
    expect(engine.cancelled).toContain('parent step aborted')
    expect(engine.disposed).toBe(1)
  })

  it('reports engine start, malformed result, and oversized result failures', async () => {
    const { ctx, engine, parent } = await setup({ maxHandoffChars: 40 })
    const malformed = execute(ctx, { objective: 'x', plan: 'p', workUnits: [unit] }, parent)
    await new Promise(resolve => setTimeout(resolve, 0))
    engine.settle({ value: 'bad', stopReason: 'completed', agentsStarted: 1 })
    expect((await malformed).isError).toBe(true)
    const oversized = execute(ctx, { objective: 'x', plan: 'p', workUnits: [unit] }, parent)
    await new Promise(resolve => setTimeout(resolve, 0))
    engine.settle({ value: { objective: 'x', reports: ['x'.repeat(100)], steering: { applied: [], unapplied: [] } }, stopReason: 'completed', agentsStarted: 1 })
    expect((await oversized).isError).toBe(true)
  })

  it('fails without a calling agent and maps an engine start throw', async () => {
    const { ctx, engine, parent } = await setup()
    expect((await execute(ctx, { objective: 'x', plan: 'p', workUnits: [unit] })).isError).toBe(true)
    engine.startError = new Error('engine unavailable')
    expect((await execute(ctx, { objective: 'x', plan: 'p', workUnits: [unit] }, parent)).isError).toBe(true)
  })

  it('refuses a tiny non-repetitive 1-2 file unit instead of starting workers', async () => {
    const { ctx, engine, parent } = await setup()
    const result = await execute(ctx, {
      objective: 'Fix one greeting.',
      plan: 'Edit greet.js.',
      workUnits: [{ id: 'fix', role: 'implementation', task: 'Fix greet.js.', complexity: 'simple', risk: 'low', scopes: ['src/greet.js'] }],
    }, parent)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain(developmentWorkflow.TINY_WORK_REFUSED)
    expect(engine.requests).toHaveLength(0)
  })

  it('still starts a repetitive simple low-risk unit on T3', async () => {
    const { ctx, engine, parent } = await setup()
    const pending = execute(ctx, {
      objective: 'Fill five returns.',
      plan: 'Same mechanical edit five times.',
      workUnits: [{ id: 'ops', role: 'implementation', task: 'Add return to five ops.', complexity: 'simple', risk: 'low', repetitive: true, scopes: ['src/ops.js'] }],
    }, parent)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(engine.requests[0]!.args).toMatchObject({ units: [{ tier: 'T3' }] })
    engine.settle({ value: { objective: 'Fill five returns.', reports: [], steering: { applied: [], unapplied: [] } }, stopReason: 'completed', agentsStarted: 1 })
    expect((await pending).isError).toBe(false)
  })

  it('routes ordinary multi-file implementation to T2 and exceptional review to T1', async () => {
    const { ctx, engine, parent } = await setup()
    const pending = execute(ctx, {
      objective: 'Ship a store and review the contract rename.',
      plan: 'Implement then review.',
      workUnits: [
        { id: 'implement', role: 'implementation', task: 'Implement the store.', complexity: 'ordinary', risk: 'medium', scopes: ['src/store.js', 'src/validate.js', 'src/index.js'] },
        { id: 'review', role: 'review', task: 'Review the cross-component rename.', exceptional: true, scopes: ['src'] },
      ],
    }, parent)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(engine.requests[0]!.args).toMatchObject({ units: [{ tier: 'T2' }, { tier: 'T1' }] })
    engine.settle({ value: { objective: 'Ship a store and review the contract rename.', reports: [], steering: { applied: [], unapplied: [] } }, stopReason: 'completed', agentsStarted: 2 })
    await pending
  })

  it('can disable tiny-work refusal from config', async () => {
    const { ctx, engine, parent } = await setup({ refuseTinyNonRepetitive: false })
    const pending = execute(ctx, {
      objective: 'Fix one greeting.',
      plan: 'Edit greet.js.',
      workUnits: [{ id: 'fix', role: 'implementation', task: 'Fix greet.js.', complexity: 'simple', risk: 'low', scopes: ['src/greet.js'] }],
    }, parent)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(engine.requests).toHaveLength(1)
    expect(engine.requests[0]!.args).toMatchObject({ units: [{ tier: 'T2' }] })
    engine.settle({ value: { objective: 'Fix one greeting.', reports: [], steering: { applied: [], unapplied: [] } }, stopReason: 'completed', agentsStarted: 1 })
    await pending
  })

  it('forwards user-origin inbox insertions into the running run and stops at settlement', async () => {
    const { ctx, engine, parent } = await setup()
    const pending = execute(ctx, { objective: 'Ship the change.', plan: 'Inspect then validate.', workUnits: [unit] }, parent)
    await new Promise(resolve => setTimeout(resolve, 0))
    agentEvents(ctx, parent).emit('agent/inbox/inserted', {
      message: createUserMessage({ content: [{ type: 'text', text: 'skip the rename' }], source: { kind: 'user' } }),
    })
    agentEvents(ctx, parent).emit('agent/inbox/inserted', {
      message: createUserMessage({ content: [{ type: 'text', text: 'skills catalog' }], source: { kind: 'plugin', plugin: 'skill' } }),
    })
    expect(engine.steers).toEqual(['skip the rename'])
    engine.settle({ value: { objective: 'Ship the change.', reports: [], steering: { applied: ['skip the rename'], unapplied: [] } }, stopReason: 'completed', agentsStarted: 1 })
    await pending
    agentEvents(ctx, parent).emit('agent/inbox/inserted', {
      message: createUserMessage({ content: [{ type: 'text', text: 'after the run' }], source: { kind: 'user' } }),
    })
    expect(engine.steers).toEqual(['skip the rename'])
  })

  it('names applied and too-late steering in the rendered result', async () => {
    const { ctx, engine, parent } = await setup()
    const pending = execute(ctx, { objective: 'Ship the change.', plan: 'Inspect then validate.', workUnits: [unit] }, parent)
    await new Promise(resolve => setTimeout(resolve, 0))
    engine.settle({
      value: { objective: 'Ship the change.', reports: [{ id: 'inspect' }], steering: { applied: ['skip the rename'], unapplied: ['also update the README'] } },
      stopReason: 'completed',
      agentsStarted: 1,
    })
    const result = await pending
    expect(result.isError).toBe(false)
    const rendered = (result.content[0] as { text: string }).text
    expect(rendered).toContain('User guidance sent during this run reached the workers:\n- skip the rename')
    expect(rendered).toContain('arrived too late for any worker and is NOT reflected in these reports:\n- also update the README')
    // The rendered result is read by a model: its newlines are real, not escaped.
    expect(rendered).not.toContain('\\n')
  })

  it('rejects a result whose steering record is malformed or missing', async () => {
    const { ctx, engine, parent } = await setup()
    const malformed = execute(ctx, { objective: 'Ship the change.', plan: 'Inspect then validate.', workUnits: [unit] }, parent)
    await new Promise(resolve => setTimeout(resolve, 0))
    engine.settle({ value: { objective: 'x', reports: [], steering: { applied: [7], unapplied: [] } }, stopReason: 'completed', agentsStarted: 1 })
    const malformedResult = await malformed
    expect(malformedResult.isError).toBe(true)
    expect((malformedResult.content[0] as { text: string }).text).toContain('malformed result')

    const missing = execute(ctx, { objective: 'Ship the change.', plan: 'Inspect then validate.', workUnits: [unit] }, parent)
    await new Promise(resolve => setTimeout(resolve, 0))
    engine.settle({ value: { objective: 'x', reports: [] }, stopReason: 'completed', agentsStarted: 1 })
    const missingResult = await missing
    expect(missingResult.isError).toBe(true)
    expect((missingResult.content[0] as { text: string }).text).toContain('malformed result')
  })

  it('still forwards steering from a nested transport call that writes no durable run record', async () => {
    const { ctx, engine, parent, session } = await setup()
    // A transport sub-dispatch carries a parent token, which suppresses the
    // durable record. Forwarding does not depend on that recording decision.
    const pending = ctx.tools.execute({
      name: 'delegate_work',
      arguments: { objective: 'Ship the change.', plan: 'Inspect then validate.', workUnits: [unit] },
      callId: CallId('development-nested'),
      parent: Symbol('outer-run-code') as ToolExecutionToken,
      signal: new AbortController().signal,
      agent: parent,
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    agentEvents(ctx, parent).emit('agent/inbox/inserted', {
      message: createUserMessage({ content: [{ type: 'text', text: 'nested guidance' }], source: { kind: 'user' } }),
    })
    expect(engine.steers).toEqual(['nested guidance'])
    engine.settle({ value: { objective: 'Ship the change.', reports: [], steering: { applied: ['nested guidance'], unapplied: [] } }, stopReason: 'completed', agentsStarted: 1 })
    expect((await pending).isError).toBe(false)
    expect(session.events).toEqual([])
  })

  it('unregisters the tool and prompt section on HMR disposal', async () => {
    const { ctx, fiber } = await setup()
    expect(ctx.tools.get('delegate_work')).toBeDefined()
    expect((await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'tool:delegate_work')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.get('delegate_work')).toBeUndefined()
    expect((await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'tool:delegate_work')).toBe(false)
  })
})
