// Real-host acceptance for the behaviors this change set introduces, driven
// through the shipped Web server's own RPC surface and a real chromium.
//
// The four scenarios are the ones package tests and keyless replay cannot
// prove together: a keyless DuckDuckGo search reached through the shipped
// provider list, the guarded `web_fetch` refusing a private address, a
// background child report arriving as next-step context rather than a queue
// row, and mid-run workflow steering producing a durable receipt the panel
// renders.
//
// Credentials: the harness resolves the host's own `~/.dsh` OAuth, so this
// file pins only the model route. `DSH_HOME` stays isolated so sessions never
// land beside the developer's; `HOME` is inherited on purpose, because the
// OAuth store is the credential under test.
//
// Selector convention matches the rest of this lane: anchor on data-*
// attributes or visible text, never on hashed CSS Module class names.
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { REPO_ROOT, connectFreshWorkspace, newEnglishPage, probeFreePort, requireDist, saveFailureShot } from './support.ts'

const OAUTH_STORE = join(process.env.HOME ?? '', '.dsh/.oauth.json')
const PROVIDER = 'openai-codex'
const MODEL = 'gpt-5.6-luna'

const UI_PLUGIN_DIRS = [
  'connection', 'runtime', 'ui-theme', 'locale', 'ui-layout', 'ui-sidebar',
  'ui-conversation', 'ui-trajectory', 'ui-workflow-run', 'ui-subagent',
]
const notReady = UI_PLUGIN_DIRS.filter((dir) => {
  const bundle = join(REPO_ROOT, 'packages/client', dir, 'lib/client.js')
  return !existsSync(bundle) || !readFileSync(bundle, 'utf8').includes('exports.apply')
})
if (notReady.length > 0) console.warn(`[wip-real] skipped — client bundles not ready: ${notReady.join(', ')}`)

function waitForReadyLine(child: ChildProcess): Promise<string> {
  return new Promise((resolveReady, reject) => {
    let out = ''
    const timer = setTimeout(() => { reject(new Error(`dsh web not ready in 90s; output:\n${out}`)) }, 90_000)
    const onData = (chunk: Buffer): void => {
      out += chunk.toString()
      const match = /dsh web: (http:\/\/[^\s]+)/.exec(out)
      if (match?.[1] !== undefined) {
        clearTimeout(timer)
        resolveReady(match[1])
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`dsh web exited early (code ${code}); output:\n${out}`))
    })
  })
}

async function rpc<T>(baseUrl: string, method: string, payload: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `wip-${method}`, method, payload }),
  })
  if (!response.ok) throw new Error(`${method} failed over HTTP ${response.status}: ${await response.text()}`)
  const body = await response.json() as {
    result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
  }
  if (!body.result.ok) throw new Error(`${method} failed: ${body.result.error.code}: ${body.result.error.message}`)
  return body.result.value
}

interface HistoryPage {
  events: { event: { type: string; data: unknown } }[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function history(baseUrl: string, sessionId: string): Promise<HistoryPage> {
  return rpc<HistoryPage>(baseUrl, 'session.history', { sessionId, maxMessages: 200 })
}

/**
 * Every tool result text in the session, so a scenario can assert on tool
 * behavior. The result content lives under the event's `message`, which is a
 * `ToolResultMessage`, not directly on the event data.
 */
function toolResultTexts(page: HistoryPage): string[] {
  const texts: string[] = []
  for (const { event } of page.events) {
    if (event.type !== 'tool/result' || !isRecord(event.data)) continue
    const message = event.data.message
    if (!isRecord(message) || !Array.isArray(message.content)) continue
    // A `tool-result` block nests the model-facing text one level further in.
    for (const block of message.content) {
      if (!isRecord(block) || !Array.isArray(block.content)) continue
      for (const inner of block.content) {
        if (isRecord(inner) && inner.type === 'text' && typeof inner.text === 'string') texts.push(inner.text)
      }
    }
  }
  return texts
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(REPO_ROOT, '.artifacts', `wip-${name}.png`), fullPage: false })
}

describe.skipIf(!existsSync(OAUTH_STORE) || notReady.length > 0)('web wip acceptance (real host, real model)', () => {
  let child: ChildProcess
  let workDir: string
  let baseUrl: string
  let browser: Browser
  let page: Page
  const pageErrors: string[] = []

  beforeAll(async () => {
    requireDist()
    workDir = mkdtempSync(join(tmpdir(), 'dsh-web-wip-'))
    // The isolated home starts empty, so it would otherwise resolve the
    // shipped default route and fail MISSING_CREDENTIAL. Pin the subscription
    // route this host is actually authenticated for and carry the OAuth store
    // across; sessions and settings still stay inside the temp world.
    const isolatedHome = join(workDir, '.dsh')
    mkdirSync(isolatedHome, { recursive: true })
    copyFileSync(OAUTH_STORE, join(isolatedHome, '.oauth.json'))
    writeFileSync(join(isolatedHome, 'settings.yaml'), [
      'agent-default-model:',
      `  provider: ${PROVIDER}`,
      `  model: ${MODEL}`,
      'llm-pi-ai:',
      '  providers:',
      `    ${PROVIDER}:`,
      '      auth: subscription',
      '      transport: sse',
      '',
    ].join('\n'))
    const port = await probeFreePort()
    const tsxLoader = pathToFileURL(createRequire(join(REPO_ROOT, 'package.json')).resolve('tsx')).href
    child = spawn(
      process.execPath,
      [
        '--import', tsxLoader, join(REPO_ROOT, 'apps/cli/src/bin.ts'), 'web',
        '--patch', fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
        '--port', String(port),
      ],
      {
        cwd: workDir,
        env: {
          ...process.env,
          // Sessions and settings stay in the temp world; HOME is inherited so
          // the real OAuth store still resolves.
          DSH_HOME: join(workDir, '.dsh'),
          DSH_AGENTS_HOME: join(workDir, '.agents'),
          TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    baseUrl = (await waitForReadyLine(child)).replace('0.0.0.0', '127.0.0.1')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    page.on('pageerror', e => pageErrors.push(String(e)))
    await page.goto(baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // A fresh home opens the internal testing notice, whose modal swallows the
    // workspace-picker click until it is dismissed.
    const notice = page.getByRole('button', { name: 'Continue' })
    if (await notice.count() > 0) await notice.click()
    // The browser scenario types into the composer, so it needs a connected
    // workspace; the RPC scenarios drive their own sessions independently.
    await connectFreshWorkspace(page, workDir)
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    if (child !== undefined && child.exitCode === null) {
      const gone = new Promise<void>(resolveExit => child.once('exit', () => { resolveExit() }))
      child.kill('SIGTERM')
      await Promise.race([gone, new Promise(r => setTimeout(r, 10_000).unref())])
      if (child.exitCode === null) child.kill('SIGKILL')
    }
    if (workDir !== undefined) rmSync(workDir, { recursive: true, force: true })
  })

  /** Start one session in the isolated workspace and return its id. */
  async function newSession(): Promise<string> {
    const created = await rpc<{ sessionId: string }>(baseUrl, 'session.create', { cwd: workDir })
    return created.sessionId
  }

  async function send(sessionId: string, text: string): Promise<void> {
    await rpc(baseUrl, 'session.prompt', {
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
    })
  }

  /**
   * Wait for the turn to close, then fail loudly on an errored turn. Without
   * the reason check a MISSING_CREDENTIAL turn ends instantly and every later
   * assertion reports an absent tool call instead of the real cause.
   */
  async function waitForIdle(sessionId: string, timeout = 180_000): Promise<void> {
    let reason: unknown
    await expect.poll(async () => {
      for (const { event } of (await history(baseUrl, sessionId)).events) {
        if (event.type === 'turn/end' && isRecord(event.data)) reason = event.data.reason
      }
      return reason !== undefined
    }, { timeout }).toBe(true)
    if (isRecord(reason) && reason.kind === 'error') {
      throw new Error(`turn ended in error: ${JSON.stringify(reason.error)}`)
    }
  }

  it('reaches DuckDuckGo through the shipped keyless provider list', async () => {
    onTestFailed(() => saveFailureShot(page, 'wip-web-search'))
    const sessionId = await newSession()
    await send(sessionId, 'Use the web_search tool exactly once for the query "deepseek harness github". Then reply with the single word SEARCH_DONE and stop.')
    await waitForIdle(sessionId)
    const events = await history(baseUrl, sessionId)
    const calls = events.events.filter(({ event }) =>
      event.type === 'tool/call' && isRecord(event.data) && event.data.name === 'web_search')
    expect(calls.length).toBeGreaterThan(0)
    // No DeepSeek key exists in this world, so a result at all proves the
    // ordered list fell through to the keyless DuckDuckGo provider.
    const results = toolResultTexts(events)
    expect(results.join('\n')).toMatch(/http/)
    await shot(page, 'web-search')
  }, 240_000)

  it('refuses a private address through the guarded web_fetch', async () => {
    onTestFailed(() => saveFailureShot(page, 'wip-ssrf'))
    const sessionId = await newSession()
    await send(sessionId, 'Call the web_fetch tool exactly once with the url http://127.0.0.1:9/ and then report the exact error text you received. Do not retry.')
    await waitForIdle(sessionId)
    const results = toolResultTexts(await history(baseUrl, sessionId)).join('\n')
    // The guard refuses before any connection: the loopback literal never
    // reaches the network stack, and it names the matched range.
    expect(results).toContain('blocked private-network fetch target 127.0.0.1')
    expect(results).toContain('IPv4 loopback (127.0.0.0/8)')
    await shot(page, 'ssrf-denied')
  }, 240_000)

  it('delivers a background child report as next-step context, not a queue row', async () => {
    onTestFailed(() => saveFailureShot(page, 'wip-subagent'))
    const sessionId = await newSession()
    await send(sessionId, 'Start exactly one background subagent with the subagent tool whose entire prompt is: Reply with exactly the word CHILD_OK and nothing else. After it reports back to you, reply with the single word PARENT_SAW_REPORT and stop.')
    // `subagent/descriptor` belongs to the child's own session; the parent
    // observes the delegation through its own tool call.
    await expect.poll(async () => {
      const events = await history(baseUrl, sessionId)
      return events.events.some(({ event }) =>
        event.type === 'tool/call' && isRecord(event.data) && event.data.name === 'subagent')
    }, { timeout: 180_000 }).toBe(true)
    await waitForIdle(sessionId, 240_000)
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // The report is next-step context: it must not appear as a pending queue
    // row in the dock after the parent consumed it.
    const queued = await page.locator('[data-queue-dock] li').count()
    expect(queued).toBe(0)
    await shot(page, 'subagent-report')
  }, 300_000)

  it('records mid-run workflow steering and renders the durable receipt after reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'wip-steering'))
    // Driven through the composer, not RPC: the panel under test only renders
    // for the session the browser actually has open.
    const input = page.locator('textarea').first()
    await input.fill([
      'Use the workflow tool exactly once, with args omitted, meta set to',
      '{ "name": "wip-flow", "description": "one child" }, and this EXACT script body:',
      "phase('Run')",
      "const first = await agent('Reply with exactly the word ONE and nothing else.')",
      'const guidance = await steering()',
      "const second = await agent('Reply with exactly the word TWO and nothing else.')",
      'return { first, second, guidance }',
      'After the workflow returns, reply with the single word FLOW_DONE and stop.',
    ].join('\n'))
    await input.press('Enter')

    const panel = page.locator('[data-workflow-run]').first()
    await panel.waitFor({ timeout: 180_000 })
    // A real user gesture while the foreground workflow holds the parent turn.
    await input.fill('prefer the shorter option')
    await input.press('Meta+Enter')

    const receipt = page.locator('[data-workflow-steering]').first()
    await receipt.waitFor({ timeout: 120_000 })
    expect(await receipt.textContent()).toContain('Received 1 of your messages during this run')
    await shot(page, 'workflow-steering-live')

    // The receipt is durable, not view state: it survives a reload.
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const settled = page.locator('[data-workflow-run]').first()
    await settled.waitFor({ timeout: 60_000 })
    if (await settled.getAttribute('aria-expanded') === 'false') await settled.click()
    const durable = page.locator('[data-workflow-steering]').first()
    await durable.waitFor({ timeout: 30_000 })
    expect(await durable.textContent()).toContain('Received 1 of your messages during this run')
    await shot(page, 'workflow-steering-reloaded')
  }, 420_000)

  it('stays free of page errors across every real scenario', () => {
    expect(pageErrors).toEqual([])
  })
})
