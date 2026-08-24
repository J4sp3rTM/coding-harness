import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { CommandId, type CommandResult } from '@deepseek-ai/dsh-commands'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillInvocationPolicy,
  SkillLookupOptions,
  SkillProvider,
  SkillSummary,
} from '@deepseek-ai/dsh-skill'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as CommandSkills from '../src/index.ts'

/** Invocation policy admitting both surfaces. */
const EVERYWHERE: SkillInvocationPolicy = { modelInvocable: true, userInvocable: true }
/** Invocation policy restricted to model-facing catalogs. */
const MODEL_ONLY_POLICY: SkillInvocationPolicy = { modelInvocable: true, userInvocable: false }

/** One canned catalog row served by the fake provider. */
function staticSkill(name: string, description: string, invocation: SkillInvocationPolicy): SkillCandidate {
  return {
    name,
    description,
    invocation,
    provider: 'static',
    source: 'static',
    rank: 10,
    locator: { content: `${name} body.` },
  }
}

/** Fake skill provider serving fixed candidates and recording lookup options. */
class StaticProvider implements SkillProvider {
  readonly name = 'static'
  /** Last lookup options received, proving option forwarding. */
  receivedOptions: SkillLookupOptions | undefined

  constructor(private candidates: SkillCandidate[]) {}

  async list(options: SkillLookupOptions): Promise<SkillCandidate[]> {
    this.receivedOptions = options
    return this.candidates
  }

  async get(candidate: SkillCandidate): Promise<SkillDefinition | undefined> {
    return { ...candidate, content: (candidate.locator as { content: string }).content }
  }
}

interface Harness {
  ctx: Context
  agent: Agent
  plugin: Awaited<ReturnType<Context['plugin']>>
  run: (line: string, signal?: AbortSignal) => Promise<CommandResult | undefined>
}

/**
 * Real agent loop, skills registry with the fake provider, command registry,
 * and the /skills command.
 */
async function boot(provider: StaticProvider): Promise<Harness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(CommandRuntime)
  const plugin = await ctx.plugin(CommandSkills)
  ctx.skills.registerProvider(() => provider)
  const agent = ctx.agentLoop.create(SessionId('skills-agent'), { provider: 'mock', model: 'mock' })
  const run = async (line: string, signal = new AbortController().signal): Promise<CommandResult | undefined> =>
    (await ctx.commands.execute(agent, line, signal))?.result
  return { ctx, agent, plugin, run }
}

describe('renderSkills', () => {
  it('sorts unsorted summaries by name without suffixing user-invocable skills', () => {
    expect(CommandSkills.renderSkills([
      staticSkill('zeta-skill', 'Checks the zeta rules', EVERYWHERE),
      staticSkill('alpha-skill', 'Writes the alpha docs', EVERYWHERE),
    ])).toBe([
      '• alpha-skill — Writes the alpha docs',
      '• zeta-skill — Checks the zeta rules',
    ].join('\n'))
  })
})

describe('/skills', () => {
  it('reports an empty catalog through the real registry', async () => {
    const { run } = await boot(new StaticProvider([]))
    expect(await run('/skills')).toEqual({ kind: 'success', text: 'No skills are available.' })
  })

  it('sorts rows by name and marks the model-only skill', async () => {
    const { run } = await boot(new StaticProvider([
      staticSkill('zeta-skill', 'Checks the zeta rules', MODEL_ONLY_POLICY),
      staticSkill('alpha-skill', 'Writes the alpha docs', EVERYWHERE),
    ]))
    expect(await run('/skills')).toEqual({
      kind: 'success',
      text: [
        '• alpha-skill — Writes the alpha docs',
        '• zeta-skill — Checks the zeta rules (model-only)',
      ].join('\n'),
    })
  })

  it('ignores trailing arguments', async () => {
    const { run } = await boot(new StaticProvider([
      staticSkill('alpha-skill', 'Writes the alpha docs', EVERYWHERE),
    ]))
    expect(await run('/skills with ignored trailing words')).toEqual({
      kind: 'success',
      text: '• alpha-skill — Writes the alpha docs',
    })
  })

  it('forwards the invocation signal through the real registry', async () => {
    const provider = new StaticProvider([staticSkill('alpha-skill', 'Writes the alpha docs', EVERYWHERE)])
    const { agent, run } = await boot(provider)
    const controller = new AbortController()
    expect(await run('/skills', controller.signal)).toMatchObject({ kind: 'success' })
    expect(provider.receivedOptions).toMatchObject({
      cwd: agent.session.header.cwd,
      signal: controller.signal,
    })
  })

  it('lists skills registered in the receiving agent scope', async () => {
    const { agent, run } = await boot(new StaticProvider([]))
    const scoped = agent.ctx.get('skills')
    if (scoped === undefined) throw new Error('skills service unavailable in agent scope')
    scoped.register({
      name: 'scoped-only',
      description: 'Visible only to this agent',
      source: 'runtime',
      content: 'Scoped body.',
    })
    expect(await run('/skills')).toEqual({
      kind: 'success',
      text: '• scoped-only — Visible only to this agent',
    })
  })

  it('unregisters before disposal waits for an already-started lookup', async () => {
    const { ctx, agent, plugin, run } = await boot(new StaticProvider([]))
    const pending = Promise.withResolvers<SkillSummary[]>()
    const original = ctx.skills.list.bind(ctx.skills)
    ctx.skills.list = () => pending.promise
    const operation = run('/skills')
    let disposed = false
    const disposal = plugin.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(ctx.commands.find(agent, 'skills')).toBeUndefined()
    expect(disposed).toBe(false)
    pending.resolve([])
    await expect(operation).resolves.toEqual({ kind: 'success', text: 'No skills are available.' })
    await disposal
    expect(disposed).toBe(true)
    ctx.skills.list = original
  })

  it('rethrows a lookup failure when the request was not aborted', async () => {
    const { ctx, run } = await boot(new StaticProvider([]))
    ctx.skills.list = () => Promise.reject(new Error('catalog exploded'))
    await expect(run('/skills')).rejects.toThrow('catalog exploded')
  })

  it('maps an aborted lookup to a cancelled outcome', async () => {
    const { ctx, agent } = await boot(new StaticProvider([]))
    const reason = new Error('dispatch cancelled')
    const controller = new AbortController()
    controller.abort(reason)
    const originalList = ctx.skills.list.bind(ctx.skills)
    // Structural stub rejecting with the abort reason, standing in for the registry.
    ctx.skills.list = () => Promise.reject(reason)
    try {
      const definition = ctx.commands.find(agent, 'skills')
      expect(definition?.name).toBe('skills')
      const result = await definition!.handler({
        commandId: CommandId('cmd-skills-cancelled'),
        agent,
        rawInput: '',
        signal: controller.signal,
      })
      expect(result).toEqual({ kind: 'error', text: 'Skills lookup cancelled.' })
    } finally {
      ctx.skills.list = originalList
    }
  })
})
