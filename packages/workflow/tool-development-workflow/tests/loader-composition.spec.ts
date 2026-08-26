import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { WorkflowEngine, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type { WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
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

class StubEngine extends WorkflowEngine {
  start(_request: WorkflowStartRequest) {
    return { id: WorkflowRunId('loader-test'), meta: { name: 'test', description: 'test' }, result: Promise.resolve({ value: null, stopReason: 'completed' as const, agentsStarted: 0 }), cancel: () => {}, steer: () => true, dispose: async () => {} }
  }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-development-workflow-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: 'test-settings'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-tool-development-workflow/settings'",
    "- name: '@deepseek-ai/dsh-tool-development-workflow'",
    '',
  ].join('\n'))
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-settings', TestSettings],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-tool-development-workflow', developmentWorkflow],
    ['@deepseek-ai/dsh-tool-development-workflow/settings', developmentWorkflowSettings],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.plugin(StubEngine)
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const unloaded = [...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)
  expect(unloaded).toEqual([])
  return ctx
}

describe('delegate_work real Loader composition through cordis.yml', () => {
  it('boots the shipped namespace through Loader and exposes its schema', async () => {
    const ctx = await boot()
    expect(ctx.tools.schemas().find(schema => schema.name === 'delegate_work')).toMatchObject({ name: 'delegate_work' })
    expect((await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'tool:delegate_work')).toBe(true)
    expect(ctx.settings.describe().some(row => row.ns === developmentWorkflowSettings.DEVELOPMENT_WORKFLOW_SETTINGS_NAMESPACE)).toBe(true)
  }, 30_000)
})
