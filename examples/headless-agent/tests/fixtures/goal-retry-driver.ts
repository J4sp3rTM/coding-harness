#!/usr/bin/env node
/** Snapshot-only Loader driver for one autonomous goal round. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const NAME = 'goal-retry-test-driver'
const [configPath, ...objectiveParts] = process.argv.slice(2)
if (configPath === undefined || objectiveParts.length === 0 || objectiveParts.every(part => part.trim() === '')) {
  throw new Error(`${NAME}: expected <config-path> <objective...>`)
}

function onlyRootAgent(ctx: Context): Agent {
  const agents = ctx.get('agents')?.roots() ?? []
  const [agent] = agents
  if (agent === undefined || agents.length !== 1) {
    throw new Error(`${NAME}: expected exactly one top-level agent, found ${agents.length}`)
  }
  return agent
}

function assistantText(event: Extract<SessionEvent, { type: 'assistant/message' }>): string | undefined {
  const blocks = event.data.message.content.filter(block => block.type === 'text')
  return blocks.length === 0 ? undefined : blocks.map(block => block.text).join('')
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const agent = onlyRootAgent(ctx)
  await agent.whenIdle()

  let output = ''
  let usage: TokenUsage | undefined
  let finish: (() => void) | undefined
  const blocked = new Promise<void>((resolve) => { finish = resolve })
  const disposeListener = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    process.stdout.write(`${JSON.stringify({ type: 'session_event', sessionId: session.id, event })}\n`)
    if (event.type === 'assistant/message') {
      output = assistantText(event) ?? output
      usage = event.data.usage ?? usage
    }
    if (event.type === 'goal/change' && event.data.operation === 'block') finish?.()
  })

  try {
    ctx.goals.create(agent, { objective: objectiveParts.join(' '), maxGoalRounds: 1 })
    await blocked
    await agent.whenIdle()
    await ctx.sessions.flush(agent.session)
  } finally {
    disposeListener()
  }
  process.stdout.write(`${JSON.stringify({
    type: 'result',
    sessionId: agent.session.id,
    output,
    ...usage === undefined ? {} : { usage },
  })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
