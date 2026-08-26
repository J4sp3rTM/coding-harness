import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent-in-process-driver'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import type { WorkflowAgentInfo } from '@deepseek-ai/dsh-workflow'
import WorkerThreadWorkflowEngine from '@deepseek-ai/dsh-workflow-worker-thread'
import { MockAdapter, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as developmentWorkflow from '../src/index.ts'
import * as developmentWorkflowSettings from '../src/settings.ts'

class TestSettings extends SettingsProvider {
  private readonly testDocument: Record<string, unknown> = {}
  override get writable(): boolean { return true }
  protected override load(): Promise<Record<string, unknown>> { return Promise.resolve(structuredClone(this.testDocument)) }
  protected override persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.testDocument[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

const reasoning = {
  efforts: [
    { id: ReasoningEffortId('medium'), name: 'Medium' },
    { id: ReasoningEffortId('high'), name: 'High' },
  ],
  defaultEffort: ReasoningEffortId('medium'),
}

const report = {
  summary: 'Inspection complete.',
  changedFiles: [],
  validationEvidence: ['Read the target file.'],
  risks: [],
  followUps: [],
}

describe('development workflow over the real loader-composed engine', () => {
  it('starts a real structured child and returns its bounded report', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(spawn, { providerName: 'spawn' })
    await ctx.plugin(WorkerThreadWorkflowEngine, {})
    await ctx.plugin(developmentWorkflow, { maxWorkUnits: 2 })
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      toolCallResponse('worker-report', STRUCTURED_OUTPUT_TOOL, report),
    ]))
    const parentHandle = await ctx.agents.create({
      sessionId: SessionId('development-parent'),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('development-integration'),
      name: 'delegate_work',
      arguments: {
        objective: 'Inspect one file.',
        plan: 'Inspect the target and report evidence.',
        workUnits: [{ id: 'inspect', role: 'inspection', task: 'Inspect the package entry point.', scopes: ['package'] }],
      },
      agent: parentHandle.agent,
    })
    expect(result.isError).toBe(false)
    if (!result.isError) {
      const value = result.value as { result: { reports: unknown[] } }
      expect(value.result.reports[0]).toMatchObject({ id: 'inspect', status: 'completed', summary: 'Inspection complete.' })
    }
    await parentHandle.dispose()
  }, 20_000)

  it('forwards configured worker effort to the child first model request and records it', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(TestSettings)
    await ctx.plugin(developmentWorkflowSettings)
    await ctx.settings.update(developmentWorkflowSettings.DEVELOPMENT_WORKFLOW_SETTINGS_NAMESPACE, {
      tiers: { t2: { provider: 'mock', model: 'mock', reasoningEffort: 'high' } },
    })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(spawn, { providerName: 'spawn' })
    await ctx.plugin(WorkerThreadWorkflowEngine, {})
    await ctx.plugin(developmentWorkflow, { maxWorkUnits: 2 })
    const adapter = new MockAdapter([toolCallResponse('worker-report', STRUCTURED_OUTPUT_TOOL, report)], reasoning)
    ctx.llm.registerAdapter(['mock'], adapter)
    const starts: WorkflowAgentInfo[] = []
    const headers: SessionEvent[] = []
    ctx.on('workflow/agent-start', (_info, agent) => { starts.push(agent) })
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'request/header') headers.push(event)
    })
    const parentHandle = await ctx.agents.create({
      sessionId: SessionId('development-effort-parent'),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('development-effort'),
      name: 'delegate_work',
      arguments: {
        objective: 'Inspect one file.',
        plan: 'Inspect the target and report evidence.',
        workUnits: [{ id: 'inspect', role: 'inspection', task: 'Inspect the package entry point.', scopes: ['package'] }],
      },
      agent: parentHandle.agent,
    })
    expect(result.isError).toBe(false)
    expect(adapter.requests[0]?.reasoningEffort).toBe(ReasoningEffortId('high'))
    expect(starts[0]).toMatchObject({
      provider: 'mock',
      model: 'mock',
      effort: 'high',
      effortSource: 'configured',
    })
    const recorded = parentHandle.agent.session.events.find(event => event.type === 'tool-workflow/agent-start')
    expect(recorded?.type === 'tool-workflow/agent-start' && recorded.data).toMatchObject({
      provider: 'mock',
      model: 'mock',
      effort: 'high',
      effortSource: 'configured',
    })
    const childHeader = headers.find(event => event.type === 'request/header' && event.data.header.config.reasoningEffort === ReasoningEffortId('high'))
    expect(childHeader?.type === 'request/header' && childHeader.data.header.adapterDefaults).toBeUndefined()
    await parentHandle.dispose()
  }, 20_000)

  it('records provider-default effort separately from the effective child request', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(spawn, { providerName: 'spawn' })
    await ctx.plugin(WorkerThreadWorkflowEngine, {})
    await ctx.plugin(developmentWorkflow, { maxWorkUnits: 2 })
    const adapter = new MockAdapter([toolCallResponse('worker-report', STRUCTURED_OUTPUT_TOOL, report)], reasoning)
    ctx.llm.registerAdapter(['mock'], adapter)
    const starts: WorkflowAgentInfo[] = []
    const headers: SessionEvent[] = []
    ctx.on('workflow/agent-start', (_info, agent) => { starts.push(agent) })
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'request/header') headers.push(event)
    })
    const parentHandle = await ctx.agents.create({
      sessionId: SessionId('development-default-effort-parent'),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('development-default-effort'),
      name: 'delegate_work',
      arguments: {
        objective: 'Inspect one file.',
        plan: 'Inspect the target and report evidence.',
        workUnits: [{ id: 'inspect', role: 'inspection', task: 'Inspect the package entry point.', scopes: ['package'] }],
      },
      agent: parentHandle.agent,
    })
    expect(result.isError).toBe(false)
    expect(starts[0]).toMatchObject({ effortSource: 'provider-default' })
    expect(starts[0]?.effort).toBeUndefined()
    const recorded = parentHandle.agent.session.events.find(event => event.type === 'tool-workflow/agent-start')
    expect(recorded?.type === 'tool-workflow/agent-start' && recorded.data.effortSource).toBe('provider-default')
    expect(recorded?.type === 'tool-workflow/agent-start' && recorded.data.effort).toBeUndefined()
    const childHeader = headers.find(event =>
      event.type === 'request/header' && event.data.header.config.reasoningEffort === ReasoningEffortId('medium'))
    expect(childHeader?.type === 'request/header' && childHeader.data.header.adapterDefaults).toEqual({ reasoningEffort: true })
    expect(adapter.requests[0]?.reasoningEffort).toBe(ReasoningEffortId('medium'))
    await parentHandle.dispose()
  }, 20_000)

  it('reports steering that arrives after every unit started as unapplied', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(spawn, { providerName: 'spawn' })
    await ctx.plugin(WorkerThreadWorkflowEngine, {})
    await ctx.plugin(developmentWorkflow, { maxWorkUnits: 2 })
    const adapter = new MockAdapter([
      toolCallResponse('worker-report', STRUCTURED_OUTPUT_TOOL, report),
      toolCallResponse('worker-report', STRUCTURED_OUTPUT_TOOL, report),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const parentHandle = await ctx.agents.create({
      sessionId: SessionId('development-steering-unapplied-parent'),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    ctx.on('workflow/agent-start', (_info, agent) => {
      if (agent.seq !== 2) return
      parentHandle.agent.inject(createUserMessage({
        content: [{ type: 'text', text: 'after all units started' }],
        source: { kind: 'user' },
      }))
    })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('development-steering-unapplied'),
      name: 'delegate_work',
      arguments: {
        objective: 'Inspect two files.',
        plan: 'Inspect both targets and report evidence.',
        workUnits: [
          { id: 'inspect-first', role: 'inspection', task: 'Inspect the first entry point.', scopes: ['first'] },
          { id: 'inspect-second', role: 'inspection', task: 'Inspect the second entry point.', scopes: ['second'] },
        ],
      },
      agent: parentHandle.agent,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected the delegation to succeed')
    const value = result.value as { result: { steering: { applied: string[]; unapplied: string[] } } }
    expect(value.result.steering.applied).toEqual([])
    expect(value.result.steering.unapplied).toEqual(['after all units started'])
    await parentHandle.dispose()
  }, 20_000)

  it('a message the user sends mid-run reaches the units that have not started yet', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(spawn, { providerName: 'spawn' })
    await ctx.plugin(WorkerThreadWorkflowEngine, {})
    await ctx.plugin(developmentWorkflow, { maxWorkUnits: 2 })
    const adapter = new MockAdapter([
      toolCallResponse('worker-report', STRUCTURED_OUTPUT_TOOL, report),
      toolCallResponse('worker-report', STRUCTURED_OUTPUT_TOOL, report),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const parentHandle = await ctx.agents.create({
      sessionId: SessionId('development-steering-parent'),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    // Deliver the message as the first unit starts, through the real inbox the
    // composer writes to. `inject` rather than `steer` keeps the test on the
    // forwarding path: this tool call has no open parent turn to wake.
    ctx.on('workflow/agent-start', (_info, agent) => {
      if (agent.seq !== 1) return
      parentHandle.agent.inject(createUserMessage({
        content: [{ type: 'text', text: 'do not touch the public API' }],
        source: { kind: 'user' },
      }))
    })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('development-steering'),
      name: 'delegate_work',
      arguments: {
        objective: 'Inspect two files.',
        plan: 'Inspect both targets and report evidence.',
        workUnits: [
          { id: 'inspect-first', role: 'inspection', task: 'Inspect the first entry point.', scopes: ['first'] },
          { id: 'inspect-second', role: 'inspection', task: 'Inspect the second entry point.', scopes: ['second'] },
        ],
      },
      agent: parentHandle.agent,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected the delegation to succeed')
    const value = result.value as { result: { steering: { applied: string[]; unapplied: string[] } } }
    expect(value.result.steering.applied).toEqual(['do not touch the public API'])
    expect(value.result.steering.unapplied).toEqual([])
    // The first unit was already running; only the second carries the guidance.
    const prompts = adapter.requests.map(request => JSON.stringify(request.messages))
    expect(prompts[0]).not.toContain('do not touch the public API')
    expect(prompts[1]).toContain('do not touch the public API')
    expect(prompts[1]).toContain('it outranks the plan where they conflict')
    await parentHandle.dispose()
  }, 20_000)
})
