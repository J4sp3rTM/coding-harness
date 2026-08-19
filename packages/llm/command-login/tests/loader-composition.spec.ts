import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { MemoryLlmOAuth } from '../../llm-oauth/tests/memory.ts'
import type { LlmOAuthInteraction } from '@deepseek-ai/dsh-llm-oauth'
import * as CommandLogin from '@deepseek-ai/dsh-command-login'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Test flow matching providers that report a device code and poll without prompting. */
class DeviceCodeOAuth extends MemoryLlmOAuth {
  override async login(provider: string, interaction: LlmOAuthInteraction) {
    interaction.notify({
      kind: 'device-code',
      verificationUri: 'https://example.test/device',
      userCode: 'ABCD-EFGH',
    })
    await Promise.resolve()
    return {
      provider,
      displayName: 'xAI',
      loginLabel: 'xAI (Grok)',
      signedIn: true,
    }
  }
}

describe('/login real Loader composition through cordis.yml', () => {
  it('shows a device code and records the command outcome without model-visible output', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-command-login-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@deepseek-ai/dsh-user-questions'",
      "- name: '@test/device-code-oauth'",
      "- name: '@deepseek-ai/dsh-command-login'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-session', SessionStore],
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['@deepseek-ai/dsh-user-questions', UserQuestionService],
      ['@test/device-code-oauth', DeviceCodeOAuth],
      ['@deepseek-ai/dsh-command-login', CommandLogin],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const asked: AskUserQuestionRequest[] = []
    context.userQuestions.registerProvider({
      ask(request) {
        asked.push(request)
        const id = request.questions[0]?.id ?? 'missing'
        return Promise.resolve({ answers: [{ id, selected: ['I have entered the code'] }] })
      },
    })
    const session = context.sessions.create(SessionId('login-loader-agent'))
    const owner = { id: session.id, session, options: {} } as unknown as Agent
    context.agents.enter(owner, undefined)
    context.agents.announce(owner)

    const execution = await context.commands.execute(
      owner,
      '/login xai',
      new AbortController().signal,
    )

    expect(execution?.result).toEqual({
      kind: 'success',
      text: 'Signed in to xai (xAI (Grok)). Requests on this route now use the subscription; /logout xai reverses it.',
    })
    expect(asked[0]?.questions[0]?.detail).toContain('ABCD-EFGH')
    expect(owner.session.events.map(event => event.type)).toEqual(['command/run', 'command/done'])
    expect(owner.session.deriveMessages()).toEqual([])
  })
})
