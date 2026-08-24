/** One-shot eval driver that mounts the shipped `code` agent preset. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import z from '@deepseek-ai/schemastery'

/** Stable loader name for the evaluation-only headless replacement. */
export const name = 'harness-eval-driver'
export const inject = ['agentDefaultModel', 'agents', 'sessions', 'agentPresets', 'headlessStartup']

/** Driver configuration supplied by the temporary patch. */
export interface Config { task: string }
export const Config: z<Config> = z.object({ task: z.string().required() })

interface RunOutcome {
  text: string
  reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
}

function summarize(events: readonly SessionEvent[], firstSeq: number): RunOutcome {
  let text = ''
  let reason: RunOutcome['reason']
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'assistant/message') {
      text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

/** Mount the shipped Code preset, execute one turn, flush persistence, and exit. */
export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('harness-eval-driver: appExit is unavailable')
  void (async () => {
    await ctx.get('loader')?.await()
    const selection = {
      ...ctx.agentDefaultModel.currentSelection(),
      reasoningEffort: ReasoningEffortId('high'),
    }
    const { agent } = await ctx.agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: async (agentCtx) => {
        await ctx.agentPresets.mount(agentCtx, 'code')
        const selected: ModelSelectionRef = { current: selection, assembled: undefined }
        installModelSelection(agentCtx, selected)
      },
    })
    await agent.whenIdle()
    const firstSeq = agent.session.seq
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: config.task }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
    await ctx.sessions.flush(agent.session)
    const outcome = summarize(agent.session.events, firstSeq)
    process.stdout.write(`${outcome.text}\n`)
    if (outcome.reason?.kind === 'error') {
      process.stderr.write(`harness-eval-driver: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`)
    }
    exit(outcome.reason?.kind === 'completed' ? 0 : 1)
  })().catch((error: unknown) => {
    process.stderr.write(`harness-eval-driver: ${error instanceof Error ? error.message : String(error)}\n`)
    exit(1)
  })
}
