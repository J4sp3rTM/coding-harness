import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCodexVsHarnessExecutor,
  codexConfigText,
  createDeadlineSignal,
  createInactivityWatchdog,
  createDeepSeekHarnessLaunch,
  runCodexExecutor,
  runDeepSeekHarnessExecutor,
  resolveCodexExecutorArgv,
} from '../src/executors.ts'

const roots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

async function workspace(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `dsh-eval-executor-${label}-`))
  roots.push(root)
  return root
}

describe('real evaluation adapters', () => {
  it('aborts only after a complete interval without activity', async () => {
    vi.useFakeTimers()
    const watchdog = createInactivityWatchdog(100, 'stalled')
    await vi.advanceTimersByTimeAsync(80)
    watchdog.touch()
    await vi.advanceTimersByTimeAsync(80)
    expect(watchdog.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(21)
    expect(watchdog.signal.aborted).toBe(true)
    expect(watchdog.signal.reason).toMatchObject({ message: 'stalled' })
    watchdog.dispose()
  })

  it('aborts the wall-clock deadline regardless of activity', async () => {
    vi.useFakeTimers()
    const deadline = createDeadlineSignal(100, 'wall cap exceeded')
    await vi.advanceTimersByTimeAsync(101)
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.signal.reason).toMatchObject({ message: 'wall cap exceeded' })
    deadline.dispose()
    expect(() => createDeadlineSignal(0, 'invalid')).toThrow(/wall timeout must be a positive integer/)
  })

  it('skips Codex without an OpenRouter key instead of inventing a result', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    const cwd = await workspace('codex-skip')
    const result = await runCodexExecutor({ task: 'do not run', cwd, evidenceDir: join(cwd, 'evidence') })
    expect(result.status).toBe('skipped')
    expect(result.skipReason).toMatch(/OPENROUTER_API_KEY/)
    expect(result.process).toBeNull()
  })

  it('pins Codex to the same Ox/high OpenRouter route', () => {
    const config = codexConfigText()
    expect(config).toContain('model = "stealth/ox-alpha"')
    expect(config).toContain('model_reasoning_effort = "high"')
    expect(config).toContain('wire_api = "responses"')
    expect(config).toContain('env_key = "OPENROUTER_API_KEY"')
    expect(config).toContain('sandbox_mode = "danger-full-access"')
    expect(config).toContain('plugins = false')
    expect(config).toContain('recommended_plugins = false')
    expect(config).toContain('remote_plugin = false')
    expect(config).toContain('shell_snapshot = false')
  })

  it('prefers the executable bundled with Codex Desktop on Windows', async () => {
    const localAppData = await workspace('codex-desktop')
    const executable = join(localAppData, 'OpenAI', 'Codex', 'bin', 'runtime-id', 'codex.exe')
    await mkdir(join(localAppData, 'OpenAI', 'Codex', 'bin', 'runtime-id'), { recursive: true })
    await writeFile(executable, '')
    const argv = await resolveCodexExecutorArgv({}, 'win32', localAppData)
    expect(argv).toEqual([executable, 'app-server', '--stdio'])
  })

  it('skips Harness when the selected OAuth home has no token store', async () => {
    const cwd = await workspace('harness-skip')
    const home = await workspace('empty-home')
    const result = await runDeepSeekHarnessExecutor({ task: 'do not run', cwd, evidenceDir: join(cwd, 'evidence') }, { harnessHome: home })
    expect(result.status).toBe('skipped')
    expect(result.skipReason).toContain(join(home, '.oauth.json'))
    expect(result.process).toBeNull()
  })

  it('rejects generic repository instructions in a benchmark workspace', async () => {
    const cwd = await workspace('instructions')
    await writeFile(join(cwd, 'AGENTS.md'), 'not part of this benchmark\n')
    await expect(runCodexExecutor({ task: 'do not run', cwd, evidenceDir: join(cwd, 'evidence') }, { apiKey: 'unused' }))
      .rejects.toThrow(/generic instructions/)
  })

  it('keeps the default Harness home explicit', async () => {
    expect(process.env.DSH_HOME ?? join(homedir(), '.dsh')).toBeTruthy()
  })

  it('maps Variant A to Codex and Variant B to DeepSeek Harness', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    const cwd = await workspace('mapping')
    const executor = createCodexVsHarnessExecutor({}, { harnessHome: await workspace('mapping-home') })
    const input = { fixture: { id: 'tiny-localized', task: 'noop', root: cwd, validation: { command: 'node', args: [] }, units: [] }, repetition: 0, sequence: 1, workdir: cwd } as const
    const a = await executor({ ...input, variant: 'A' })
    const b = await executor({ ...input, variant: 'B', sequence: 2 })
    expect(a?.executor).toBe('codex')
    expect(b?.executor).toBe('deepseek-harness')
    expect(a?.skipped?.reason).toMatch(/OPENROUTER_API_KEY/)
    expect(b?.skipped?.reason).toMatch(/OAuth document/)
  })

  it('builds a patch that mounts the shipped Code preset and Ox Alpha route', async () => {
    const launch = await createDeepSeekHarnessLaunch()
    const patch = await readFile(launch.patchPath, 'utf8')
    expect(patch).toContain('default: code')
    expect(launch.presetComposition).toMatch(/[\\/]agent-presets[\\/]code[\\/]agent\.cordis\.yml$/)
    expect(patch).toContain('stealth/ox-alpha')
    expect(patch).toContain('reasoningEfforts: { low: low, high: high, max: max }')
    expect(patch).toContain('name: "file:///')
    expect(launch.args).toContain('--patch')
    await rm(launch.patchPath, { force: true })
    await rm(launch.patchPath.replace(/[/\\][^/\\]+$/, ''), { recursive: true, force: true })
  })
})
