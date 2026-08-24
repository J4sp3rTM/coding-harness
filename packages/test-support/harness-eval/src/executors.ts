/** Real execution adapters used by the harness A/B evaluator.
 *
 * The adapters are deliberately independent of the benchmark runner. They
 * receive a copied workspace and return process facts plus model metadata;
 * validation remains a separate, completion-based operation in `process.ts`.
 * Credentials are read only at the process boundary and are never written to
 * an artifact directory.
 */

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { CodexAppServerWire, codexAppServerArgv } from '@deepseek-ai/dsh-subagent-codex'
import type { NormalizedCost, NormalizedUsage } from './types.ts'
import type { EvalExecutor, EvalExecutorInput, EvalExecutorResult } from './runner.ts'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** The single model used by both A/B sides of the current evaluation. */
export const OX_ALPHA_MODEL = 'stealth/ox-alpha'
/** The configured reasoning effort used by both adapters. */
export const OX_ALPHA_REASONING_EFFORT = 'high'
/** OpenRouter endpoint used by the Codex custom provider. */
export const OPENROUTER_RESPONSES_URL = 'https://openrouter.ai/api/v1'

/**
 * Render the non-secret Codex configuration used by every live evaluation.
 * @returns Codex TOML configuration with the shared model and provider.
 */
export function codexConfigText(): string {
  return [
    `model = ${JSON.stringify(OX_ALPHA_MODEL)}`,
    'model_provider = "openrouter-eval"',
    'model_context_window = 1048576',
    `model_reasoning_effort = ${JSON.stringify(OX_ALPHA_REASONING_EFFORT)}`,
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    'disable_response_storage = true',
    'check_for_update_on_startup = false',
    '[features]',
    'plugins = false',
    'recommended_plugins = false',
    'remote_plugin = false',
    'shell_snapshot = false',
    '[model_providers.openrouter-eval]',
    'name = "OpenRouter evaluation"',
    `base_url = ${JSON.stringify(OPENROUTER_RESPONSES_URL)}`,
    'env_key = "OPENROUTER_API_KEY"',
    'wire_api = "responses"',
    'requires_openai_auth = false',
    '',
  ].join('\n')
}

/** One copied benchmark workspace passed to an executor. */
export interface ExecutorRequest {
  /** User task sent to the model. */
  readonly task: string
  /** Absolute benchmark workspace. */
  readonly cwd: string
  /** Directory receiving non-secret stdout/stderr evidence. */
  readonly evidenceDir: string
  /** Maximum silence before the model process is treated as stalled. */
  readonly stallTimeoutMs?: number
  /**
   * Maximum wall-clock time for one executor run regardless of stream
   * activity; keeps chatty-but-progressless runs from blocking the schedule.
   */
  readonly wallTimeoutMs?: number
}

/** Process facts retained for the evaluator and its report. */
export interface ExecutorProcessFacts {
  readonly exitCode: number | null
  readonly signal: string | null
  readonly timedOut: boolean
  readonly cancelled: boolean
  readonly stdout: string
  readonly stderr: string
}

/** Normalized result shared by Codex and DeepSeek Harness. */
export interface ExecutorResult {
  readonly executor: 'codex' | 'deepseek-harness'
  readonly status: 'completed' | 'failed' | 'skipped' | 'inconclusive'
  readonly skipReason: string | null
  readonly provider: string
  readonly model: string
  readonly configuredEffort: string
  readonly effectiveEffort: string | null
  readonly effortSource: 'configured'
  readonly adapterVersion: string
  readonly startedAt: string
  readonly endedAt: string
  readonly durationMs: number
  readonly timing: {
    readonly totalMs: number
    readonly startupMs: number | null
    readonly agentMs: number | null
    readonly teardownMs: number | null
  }
  readonly finalText: string
  readonly stopReason: string | null
  readonly process: ExecutorProcessFacts | null
  readonly usage: NormalizedUsage | null
  readonly cost: NormalizedCost | null
  readonly filesChanged: string[]
  readonly stdoutPath: string | null
  readonly stderrPath: string | null
  /** Fingerprint of the model-facing prompt inputs this run executed under. */
  readonly promptFingerprint: string | null
}

/** Codex adapter settings. Values are test-only and do not affect user config. */
export interface CodexExecutorOptions {
  /** Explicit key; defaults to `OPENROUTER_API_KEY` and is never persisted. */
  readonly apiKey?: string
  /** Override the Codex executable for a hermetic test. */
  readonly command?: string
  /** Override the app-server argv for a hermetic test. */
  readonly args?: string[]
  /** Maximum app-server silence before controlled cancellation. */
  readonly stallTimeoutMs?: number
  /** Maximum wall-clock time for one run regardless of stream activity. */
  readonly wallTimeoutMs?: number
}

/** DeepSeek Harness adapter settings. */
export interface DeepSeekHarnessExecutorOptions {
  /** Existing Harness home containing the OAuth token store. */
  readonly harnessHome?: string
  /** Override the source/bin launch for a built or packaged deployment. */
  readonly command?: string
  /** Fixed argv prefix before the task argument. */
  readonly args?: string[]
  /** Explicit profile name recorded in the result. */
  readonly presetId?: string
  /** Maximum CLI silence before controlled cancellation. */
  readonly stallTimeoutMs?: number
  /** Maximum wall-clock time for one run regardless of stream activity. */
  readonly wallTimeoutMs?: number
}

/** Resolved launch details used for tests and diagnostics without exposing secrets. */
export interface DeepSeekHarnessLaunch {
  readonly command: string
  readonly args: string[]
  readonly env: Record<string, string>
  readonly patchPath: string
  readonly presetComposition: string
  readonly model: string
  readonly effort: string
}

/** Metadata used by the comparison artifact for one real adapter. */
export interface RealExecutorMetadata {
  readonly id: 'codex' | 'deepseek-harness'
  readonly version: string
  readonly model: string
  readonly effort: string
  readonly evidence: string[]
}

function missingPath(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}

async function desktopCodexExecutable(localAppData: string | undefined): Promise<string | undefined> {
  if (localAppData === undefined || localAppData.length === 0) return undefined
  const root = join(localAppData, 'OpenAI', 'Codex', 'bin')
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error: unknown) {
    if (missingPath(error)) return undefined
    throw error
  }
  const candidates: Array<{ path: string; mtimeMs: number }> = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = join(root, entry.name, 'codex.exe')
    try {
      const info = await stat(path)
      if (info.isFile()) candidates.push({ path, mtimeMs: info.mtimeMs })
    } catch (error: unknown) {
      if (!missingPath(error)) throw error
    }
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
  return candidates[0]?.path
}

/**
 * Resolve the Codex app-server argv, preferring the executable bundled with Codex Desktop on Windows.
 * @param options - explicit command or argument overrides.
 * @param platform - host platform used for Windows launcher selection.
 * @param localAppData - Windows local application-data root containing a desktop runtime.
 * @returns direct executable and app-server arguments.
 */
export async function resolveCodexExecutorArgv(
  options: CodexExecutorOptions = {},
  platform: NodeJS.Platform = process.platform,
  localAppData: string | undefined = process.env.LOCALAPPDATA,
): Promise<string[]> {
  const fallback = codexAppServerArgv(platform)
  if (options.command !== undefined) return [options.command, ...(options.args ?? fallback.slice(1))]
  if (platform === 'win32') {
    const desktopExecutable = await desktopCodexExecutable(localAppData)
    if (desktopExecutable !== undefined) {
      return [desktopExecutable, ...(options.args ?? ['app-server', '--stdio'])]
    }
  }
  if (options.args === undefined) return fallback
  const command = fallback[0]
  if (command === undefined) throw new Error('harness-eval: Codex fallback command resolved to an empty argv')
  return [command, ...options.args]
}

/** A process launch that does not pass through a shell. */
interface ProcessLaunch {
  readonly command: string
  readonly args: string[]
  readonly cwd: string
  readonly env?: Record<string, string | undefined>
  readonly stallTimeoutMs: number
  readonly wallTimeoutMs?: number
}

const DEFAULT_STALL_TIMEOUT_MS = 600_000
/** Wall-clock cap for one executor run; chatty-but-progressless runs still end. */
const DEFAULT_WALL_TIMEOUT_MS = 1_800_000

/** Resettable abort signal used to stop only inactive executor processes. */
export interface InactivityWatchdog {
  readonly signal: AbortSignal
  touch(): void
  dispose(): void
}

/**
 * Create an inactivity watchdog whose deadline resets on every touch.
 * @param timeoutMs Inactivity duration that aborts the watchdog.
 * @param message Error message attached to an inactivity abort.
 * @returns A resettable signal and its lifecycle controls.
 */
export function createInactivityWatchdog(timeoutMs: number, message: string): InactivityWatchdog {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('harness-eval: stall timeout must be a positive integer')
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const touch = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => { controller.abort(new Error(message)) }, timeoutMs)
  }
  touch()
  return {
    signal: controller.signal,
    touch,
    dispose() { clearTimeout(timer) },
  }
}

/** One-shot deadline that aborts after `timeoutMs` regardless of stream activity. */
export interface DeadlineSignal {
  readonly signal: AbortSignal
  dispose(): void
}

/**
 * Create a wall-clock deadline signal. Unlike the inactivity watchdog it does
 * not reset, so chatty-but-progressless runs still terminate.
 * @param timeoutMs Wall-clock duration that aborts the deadline.
 * @param message Error message attached to a deadline abort.
 * @returns The deadline signal and its lifecycle controls.
 */
export function createDeadlineSignal(timeoutMs: number, message: string): DeadlineSignal {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('harness-eval: wall timeout must be a positive integer')
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort(new Error(message)) }, timeoutMs)
  return {
    signal: controller.signal,
    dispose() { clearTimeout(timer) },
  }
}

function stringError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function outputText(blocks: readonly ContentBlock[]): string {
  return blocks.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text).join('')
}

async function snapshotFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) files.set(relative(root, path), createHash('sha256').update(await readFile(path)).digest('hex'))
    }
  }
  await visit(root)
  return files
}

async function changedFiles(before: Map<string, string>, root: string): Promise<string[]> {
  const after = await snapshotFiles(root)
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter(path => before.get(path) !== after.get(path)).sort()
}

async function assertBenchmarkWorkspace(root: string): Promise<void> {
  if (!isAbsolute(root)) throw new Error('harness-eval: executor cwd must be absolute')
  const found: string[] = []
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (/^(?:AGENTS|CLAUDE)\.md$/i.test(entry.name)) found.push(path)
    }
  }
  await visit(root)
  if (found.length > 0) throw new Error(`harness-eval: benchmark workspace contains generic instructions: ${found.join(', ')}`)
}

async function oauthDocumentFor(home: string): Promise<string | null> {
  const filename = join(resolveDshHome(home), '.oauth.json')
  try {
    const raw = JSON.parse(await readFile(filename, 'utf8')) as { version?: unknown; providers?: unknown }
    if (raw.version !== 1 || raw.providers === null || typeof raw.providers !== 'object' || Array.isArray(raw.providers)) return null
    const providers = raw.providers as Record<string, unknown>
    return providers.openrouter !== undefined ? filename : null
  } catch {
    return null
  }
}

function baseResult(executor: ExecutorResult['executor'], startedAt: Date, endedAt: Date, fields: Partial<ExecutorResult>): ExecutorResult {
  return {
    executor,
    status: 'failed',
    skipReason: null,
    provider: 'openrouter',
    model: OX_ALPHA_MODEL,
    configuredEffort: OX_ALPHA_REASONING_EFFORT,
    effectiveEffort: OX_ALPHA_REASONING_EFFORT,
    effortSource: 'configured',
    adapterVersion: '1',
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    timing: {
      totalMs: endedAt.getTime() - startedAt.getTime(),
      startupMs: null,
      agentMs: null,
      teardownMs: null,
    },
    finalText: '',
    stopReason: null,
    process: null,
    usage: null,
    cost: null,
    filesChanged: [],
    stdoutPath: null,
    stderrPath: null,
    promptFingerprint: null,
    ...fields,
  }
}

async function saveEvidence(
  request: ExecutorRequest,
  processFacts: ExecutorProcessFacts,
): Promise<{ stdoutPath: string; stderrPath: string }> {
  await mkdir(request.evidenceDir, { recursive: true })
  const stdoutPath = join(request.evidenceDir, 'stdout.txt')
  const stderrPath = join(request.evidenceDir, 'stderr.txt')
  await writeFile(stdoutPath, processFacts.stdout)
  await writeFile(stderrPath, processFacts.stderr)
  return { stdoutPath, stderrPath }
}

async function withLocalSubprocess<T>(run: (runtime: SubprocessRuntime) => Promise<T>): Promise<T> {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  try {
    return await run(ctx.subprocess)
  } finally {
    await ctx.fiber.dispose()
  }
}

async function runProcess(launch: ProcessLaunch): Promise<ExecutorProcessFacts> {
  return withLocalSubprocess(async (runtime) => {
    const watchdog = createInactivityWatchdog(launch.stallTimeoutMs, 'evaluation process produced no output before the stall timeout')
    const deadline = launch.wallTimeoutMs === undefined
      ? null
      : createDeadlineSignal(launch.wallTimeoutMs, 'evaluation process exceeded the wall-clock run cap')
    const runSignal = deadline === null ? watchdog.signal : AbortSignal.any([watchdog.signal, deadline.signal])
    const child = runtime.spawn({
      argv: [launch.command, ...launch.args],
      cwd: launch.cwd,
      env: { FORCE_COLOR: '0', ...launch.env },
      graceMs: 3_000,
      signal: runSignal,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); watchdog.touch() })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); watchdog.touch() })
    try {
      const outcome = await child.done
      await child.waitForExit()
      return {
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        timedOut: runSignal.aborted,
        cancelled: false,
        stdout,
        stderr,
      }
    } catch (error: unknown) {
      return {
        exitCode: null,
        signal: null,
        timedOut: runSignal.aborted,
        cancelled: false,
        stdout,
        stderr: `${stderr}${stringError(error)}`,
      }
    } finally {
      watchdog.dispose()
      deadline?.dispose()
    }
  })
}

function defaultHarnessLaunch(): { command: string; args: string[] } {
  const repository = resolve(fileURLToPath(new URL('../../../../', import.meta.url)))
  return {
    command: process.execPath,
    args: ['--import', pathToFileURL(join(repository, 'node_modules/tsx/dist/esm/index.mjs')).href, join(repository, 'apps/cli/src/bin.ts'), '--profile', 'headless'],
  }
}

function yamlString(value: string): string {
  return JSON.stringify(value.replaceAll('\\', '/'))
}

/**
 * Create the isolated Harness invocation. The patch adds the shipped preset
 * roster and replaces the headless driver with the eval driver, which calls
 * `ctx.agentPresets.mount(agentCtx, "code")` before the first turn.
 * @param patchPath - temporary patch file to write.
 * @param repository - repository root containing shipped preset files.
 * @returns launch metadata safe to record in an evaluation artifact.
 */
async function writeHarnessLaunchPatch(
  patchPath: string,
  repository: string,
  oauthPath?: string,
): Promise<DeepSeekHarnessLaunch> {
  const presetRoot = join(repository, 'apps/cli/config/agent-presets')
  const presetPluginUrl = pathToFileURL(join(repository, 'packages/preset/agent-presets/src/index.ts')).href
  const driverUrl = pathToFileURL(join(repository, 'packages/test-support/harness-eval/src/driver.ts')).href
  const model = OX_ALPHA_MODEL
  const patch = [
    '- insert:',
    '    - id: agent-presets',
    `      name: ${yamlString(presetPluginUrl)}`,
    '      config:',
    '        default: code',
    '        includeUserRoot: false',
    '        roots:',
    `          - path: ${yamlString(presetRoot)}`,
    '            trust: system',
    '- id: llm-pi-ai',
    "  name: '@deepseek-ai/dsh-llm-pi-ai'",
    '  config:',
    '    providers:',
    '      openrouter:',
    '        additionalModels:',
    `          - id: ${model}`,
    '            name: Ox Alpha',
    '            contextWindow: 1048576',
    '            maxTokens: 131072',
    '            input: [text, image]',
    '            reasoningEfforts: { low: low, high: high, max: max }',
    '            compat: { thinkingFormat: openrouter, supportsReasoningEffort: true }',
    '- id: agent-default-model',
    "  name: '@deepseek-ai/dsh-agent-default-model'",
    '  config:',
    '    provider: openrouter',
    `    model: ${model}`,
    ...(oauthPath === undefined ? [] : [
      '- id: llm-oauth',
      "  name: '@deepseek-ai/dsh-llm-oauth-local'",
      '  config:',
      `    path: ${yamlString(oauthPath)}`,
    ]),
    '- id: headless-runner',
    "  name: '@deepseek-ai/dsh-headless'",
    '  disabled: true',
    '- insert:',
    '    - id: harness-eval-driver',
    `      name: ${yamlString(driverUrl)}`,
    '      inject: [headlessStartup]',
    '      config:',
    '        task: !!js ctx.headlessStartup.task',
    '',
  ].join('\n')
  await writeFile(patchPath, patch)
  const launch = defaultHarnessLaunch()
  return {
    command: launch.command,
    args: [...launch.args, '--patch', patchPath],
    env: { DSH_TOOLS_MODE: 'code' },
    patchPath,
    presetComposition: join(presetRoot, 'code', 'agent.cordis.yml'),
    model,
    effort: OX_ALPHA_REASONING_EFFORT,
  }
}

/**
 * Build a Harness launch and temporary composition without starting a model.
 * @param repositoryRoot Repository containing the Harness packages and presets.
 * @param oauthPath Optional OpenRouter OAuth credential file.
 * @returns Launch command, arguments, and temporary patch metadata.
 */
export async function createDeepSeekHarnessLaunch(
  repositoryRoot?: string,
  oauthPath?: string,
): Promise<DeepSeekHarnessLaunch> {
  const repository = resolve(repositoryRoot ?? fileURLToPath(new URL('../../../../', import.meta.url)))
  const patchDir = await mkdtemp(join(tmpdir(), 'dsh-harness-eval-patch-'))
  return writeHarnessLaunchPatch(join(patchDir, 'cordis.patch.yml'), repository, oauthPath)
}

/**
 * Execute one task through the official Codex app-server with an isolated
 * `CODEX_HOME` and an OpenRouter Responses provider. Missing credentials are
 * represented as `skipped`; they never become a passing run.
 * @param request - copied benchmark workspace and task.
 * @param options - optional executable and key overrides.
 * @returns normalized execution result and non-secret evidence paths.
 */
export async function runCodexExecutor(request: ExecutorRequest, options: CodexExecutorOptions = {}): Promise<ExecutorResult> {
  await assertBenchmarkWorkspace(request.cwd)
  const before = await snapshotFiles(request.cwd)
  const startedAt = new Date()
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY
  if (apiKey === undefined || apiKey.trim() === '') {
    return baseResult('codex', startedAt, new Date(), { provider: 'openrouter-eval', status: 'skipped', skipReason: 'OPENROUTER_API_KEY is unset; Codex live execution was not run.' })
  }
  const codexHome = await mkdtemp(join(tmpdir(), 'dsh-codex-eval-'))
  await writeFile(join(codexHome, 'config.toml'), codexConfigText())
  try {
    return await withLocalSubprocess(async (runtime) => {
      const argv = await resolveCodexExecutorArgv(options)
      const command = argv[0]
      if (command === undefined) throw new Error('harness-eval: Codex command resolved to an empty argv')
      const promptFingerprint = `codex/${createHash('sha256').update(codexConfigText()).update(command).digest('hex').slice(0, 16)}`
      const child = runtime.spawn({
        argv: [command, ...argv.slice(1)],
        cwd: request.cwd,
        env: { CODEX_HOME: codexHome, OPENROUTER_API_KEY: apiKey, CODEX_DISABLE_UPDATE_CHECK: '1' },
        graceMs: 3_000,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      })
      if (child.stdout === undefined || child.stdin === undefined) {
        child.terminate()
        throw new Error('harness-eval: Codex app-server did not expose piped stdio')
      }
      const wire = new CodexAppServerWire(child.stdout, child.stdin)
      const watchdog = createInactivityWatchdog(
        request.stallTimeoutMs ?? options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS,
        'Codex evaluation produced no app-server activity before the stall timeout',
      )
      const deadline = createDeadlineSignal(
        request.wallTimeoutMs ?? options.wallTimeoutMs ?? DEFAULT_WALL_TIMEOUT_MS,
        'Codex evaluation exceeded the wall-clock run cap',
      )
      const runSignal = AbortSignal.any([watchdog.signal, deadline.signal])
      let stderr = ''
      child.stdout.on('data', () => { watchdog.touch() })
      child.stderr?.on('data', (chunk) => { stderr += String(chunk); watchdog.touch() })
      const processDone: Promise<ExecutorProcessFacts> = child.done.then(
        outcome => ({ exitCode: outcome.exitCode, signal: outcome.signal, timedOut: runSignal.aborted, cancelled: false, stdout: '', stderr }),
        (error: unknown) => ({ exitCode: null, signal: null, timedOut: runSignal.aborted, cancelled: false, stdout: '', stderr: `${stderr}${stringError(error)}` }),
      )
      let disposal: Promise<{ facts: ExecutorProcessFacts; durationMs: number }> | undefined
      const disposeChild = (): Promise<{ facts: ExecutorProcessFacts; durationMs: number }> => {
        disposal ??= (async () => {
          const disposalStartedAt = Date.now()
          wire.close()
          try {
            child.stdin?.end()
          } catch {
            // Concurrent app-server exit may already have closed stdin.
          }
          child.terminate()
          const facts = await processDone
          await child.waitForExit()
          return {
            facts: { ...facts, cancelled: true },
            durationMs: Date.now() - disposalStartedAt,
          }
        })()
        return disposal
      }
      let startupMs: number | null = null
      let agentStartedAt: number | null = null
      try {
        wire.start()
        await wire.initialize(runSignal)
        await wire.startThread(request.cwd, runSignal)
        startupMs = Date.now() - startedAt.getTime()
        agentStartedAt = Date.now()
        const result = await wire.runTurn([request.task], runSignal)
        const endedAt = new Date()
        const agentMs = Date.now() - agentStartedAt
        const disposalResult = await disposeChild()
        const processFacts = disposalResult.facts
        const evidence = await saveEvidence(request, { ...processFacts, stdout: outputText(result.output) })
        return baseResult('codex', startedAt, endedAt, {
          provider: 'openrouter-eval',
          status: result.stopReason === 'completed' ? 'completed' : 'inconclusive',
          stopReason: result.stopReason,
          finalText: outputText(result.output),
          filesChanged: await changedFiles(before, request.cwd),
          process: processFacts,
          promptFingerprint,
          timing: {
            totalMs: endedAt.getTime() - startedAt.getTime(),
            startupMs,
            agentMs,
            teardownMs: disposalResult.durationMs,
          },
          ...evidence,
        })
      } catch (error: unknown) {
        const endedAt = new Date()
        const agentMs = agentStartedAt === null ? null : Date.now() - agentStartedAt
        const disposalResult = await disposeChild()
        const processFacts = disposalResult.facts
        const evidence = await saveEvidence(request, processFacts)
        return baseResult('codex', startedAt, endedAt, {
          provider: 'openrouter-eval',
          status: runSignal.aborted ? 'inconclusive' : 'failed',
          stopReason: stringError(error),
          process: processFacts,
          promptFingerprint,
          timing: {
            totalMs: endedAt.getTime() - startedAt.getTime(),
            startupMs,
            agentMs,
            teardownMs: disposalResult.durationMs,
          },
          ...evidence,
          filesChanged: await changedFiles(before, request.cwd),
        })
      } finally {
        watchdog.dispose()
        deadline.dispose()
        await disposeChild()
      }
    })
  } finally {
    await rm(codexHome, { recursive: true, force: true })
  }
}

/**
 * Execute through the DeepSeek Harness source CLI with the shipped `code`
 * preset mounted by the temporary eval composition. OAuth is read through an
 * explicit path while the process receives a temporary `DSH_HOME`, keeping
 * sessions/settings outside the user's home. A packaged deployment may
 * provide a command/argv override.
 * @param request - copied benchmark workspace and task.
 * @param options - Harness home, launcher, and preset metadata.
 * @returns normalized execution result; OAuth absence is a clear skip.
 */
export async function runDeepSeekHarnessExecutor(
  request: ExecutorRequest,
  options: DeepSeekHarnessExecutorOptions = {},
): Promise<ExecutorResult> {
  await assertBenchmarkWorkspace(request.cwd)
  const before = await snapshotFiles(request.cwd)
  const startedAt = new Date()
  const home = resolveDshHome(options.harnessHome)
  const oauthStore = await oauthDocumentFor(home)
  if (oauthStore === null) {
    return baseResult('deepseek-harness', startedAt, new Date(), { provider: 'openrouter-oauth', status: 'skipped', skipReason: `DeepSeek Harness OAuth document at ${join(home, '.oauth.json')} has no valid OpenRouter token entry; live execution was not run.` })
  }
  const repository = resolve(fileURLToPath(new URL('../../../../', import.meta.url)))
  const runHome = await mkdtemp(join(tmpdir(), 'dsh-harness-eval-home-'))
  const launch = await createDeepSeekHarnessLaunch(repository, oauthStore)
  const promptFingerprint = `harness-code-preset/${createHash('sha256').update(await readFile(launch.presetComposition, 'utf8')).digest('hex').slice(0, 16)}`
  const args = [...(options.args ?? launch.args), request.task]
  try {
    const processFacts = await runProcess({
      command: options.command ?? launch.command,
      args,
      cwd: request.cwd,
      stallTimeoutMs: request.stallTimeoutMs ?? options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS,
      wallTimeoutMs: request.wallTimeoutMs ?? options.wallTimeoutMs ?? DEFAULT_WALL_TIMEOUT_MS,
      env: {
        ...launch.env,
        DSH_HOME: runHome,
        TSX_TSCONFIG_PATH: join(repository, 'tsconfig.json'),
      },
    })
    const endedAt = new Date()
    const evidence = await saveEvidence(request, processFacts)
    return baseResult('deepseek-harness', startedAt, endedAt, {
      provider: 'openrouter-oauth',
      status: processFacts.timedOut ? 'inconclusive' : processFacts.exitCode === 0 ? 'completed' : 'failed',
      stopReason: processFacts.exitCode === 0 ? 'completed' : `process exited ${String(processFacts.exitCode)}`,
      finalText: processFacts.stdout,
      process: processFacts,
      promptFingerprint,
      filesChanged: await changedFiles(before, request.cwd),
      ...evidence,
    })
  } finally {
    await rm(dirname(launch.patchPath), { recursive: true, force: true })
    await rm(runHome, { recursive: true, force: true })
  }
}

function toEvalResult(result: ExecutorResult): EvalExecutorResult {
  return {
    executor: result.executor,
    executorOutcome: result.status,
    executorTiming: result.timing,
    parentProvider: result.provider,
    parentModel: result.model,
    parentEffort: result.configuredEffort,
    parentEffortSource: result.effortSource,
    parentEffectiveEffort: result.effectiveEffort,
    workers: [],
    agentCalls: null,
    usage: result.usage,
    cost: result.cost,
    filesChanged: result.filesChanged,
    promptFingerprint: result.promptFingerprint,
    ...(result.process === null ? {} : { process: result.process }),
    ...(result.status === 'skipped' ? { skipped: { reason: result.skipReason ?? 'executor skipped without a reason' } } : {}),
    executorEvidence: {
      stdoutPath: result.stdoutPath,
      stderrPath: result.stderrPath,
    },
  }
}

/**
 * Adapt the Codex implementation to the generic A/B runner seam.
 * @param options Optional executable, credential, and inactivity settings.
 * @returns Codex executor for the generic evaluation runner.
 */
export function createCodexExecutor(options: CodexExecutorOptions = {}): EvalExecutor {
  return async (input: EvalExecutorInput): Promise<EvalExecutorResult> => toEvalResult(await runCodexExecutor({
    task: input.fixture.task,
    cwd: input.workdir,
    evidenceDir: join(dirname(input.workdir), 'evidence', `run-${input.sequence}`),
    ...(options.stallTimeoutMs === undefined ? {} : { stallTimeoutMs: options.stallTimeoutMs }),
    ...(options.wallTimeoutMs === undefined ? {} : { wallTimeoutMs: options.wallTimeoutMs }),
  }, options))
}

/**
 * Adapt the DeepSeek Harness implementation to the generic A/B runner seam.
 * @param options Optional launch, credential, and inactivity settings.
 * @returns DeepSeek Harness executor for the generic evaluation runner.
 */
export function createDeepSeekHarnessExecutor(options: DeepSeekHarnessExecutorOptions = {}): EvalExecutor {
  return async (input: EvalExecutorInput): Promise<EvalExecutorResult> => toEvalResult(await runDeepSeekHarnessExecutor({
    task: input.fixture.task,
    cwd: input.workdir,
    evidenceDir: join(dirname(input.workdir), 'evidence', `run-${input.sequence}`),
    ...(options.stallTimeoutMs === undefined ? {} : { stallTimeoutMs: options.stallTimeoutMs }),
    ...(options.wallTimeoutMs === undefined ? {} : { wallTimeoutMs: options.wallTimeoutMs }),
  }, options))
}

/**
 * Create the requested comparison mapping: Variant A is official Codex and
 * Variant B is DeepSeek Harness. This is intentionally separate from the two
 * single-adapter factories so a caller cannot accidentally compare two runs
 * made by the same executor.
 * @param codexOptions Optional settings for Variant A.
 * @param harnessOptions Optional settings for Variant B.
 * @returns Executor that dispatches each run to its assigned variant.
 */
export function createCodexVsHarnessExecutor(
  codexOptions: CodexExecutorOptions = {},
  harnessOptions: DeepSeekHarnessExecutorOptions = {},
): EvalExecutor {
  const codex = createCodexExecutor(codexOptions)
  const harness = createDeepSeekHarnessExecutor(harnessOptions)
  return async (input: EvalExecutorInput): Promise<EvalExecutorResult> => {
    const result = input.variant === 'A' ? await codex(input) : await harness(input)
    if (result === undefined) throw new Error('harness-eval: comparison executor returned no result')
    return result
  }
}

/**
 * Return stable metadata for comparison headers and reproducible reports.
 * @param executor Executor whose metadata should be described.
 * @returns Non-secret executor, model, and evidence metadata.
 */
export function executorMetadata(executor: 'codex' | 'deepseek-harness'): RealExecutorMetadata {
  return {
    id: executor,
    version: '1',
    model: OX_ALPHA_MODEL,
    effort: OX_ALPHA_REASONING_EFFORT,
    evidence: ['executor stdout/stderr paths are recorded on each run'],
  }
}
