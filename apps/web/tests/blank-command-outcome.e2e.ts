// Keyless assembled-browser coverage for login feedback before a session has
// any chat history. The blank dashboard intentionally has no transcript rows,
// so the locally submitted result must remain visible through the frame-wide
// login-outcome toast. An unknown route finishes without external OAuth.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/blank-command-outcome', import.meta.url))
const TOAST_EXPECTED = join(SNAPSHOT_DIR, 'toast.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: blank-session login outcome', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('announces a matched result while the dashboard is still blank', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-blank-command-outcome'))
    const input = page.locator('textarea').first()
    await input.waitFor({ timeout: 10_000 })
    await input.fill('/login unavailable-e2e-route')
    await input.press('Enter')

    const toast = page.getByRole('alert')
    await toast.waitFor({ timeout: 10_000 })
    expect(await toast.textContent()).toContain('unavailable-e2e-route')
    const snapshot = await captureStableAria(page, '[role="alert"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(TOAST_EXPECTED, snapshot, MODE)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['toast.expected.md'])
  })
})
