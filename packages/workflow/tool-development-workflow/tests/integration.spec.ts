import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent-in-process-driver'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import WorkerThreadWorkflowEngine from '@deepseek-ai/dsh-workflow-worker-thread'
import { MockAdapter, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as developmentWorkflow from '../src/index.ts'

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
      toolCallResponse('worker-report', STRUCTURED_OUTPUT_TOOL, {
        summary: 'Inspection complete.',
        changedFiles: [],
        validationEvidence: ['Read the target file.'],
        risks: [],
        followUps: [],
      }),
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
})
