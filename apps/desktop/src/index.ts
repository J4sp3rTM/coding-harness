/**
 * Desktop application entry: the harness Host and its UI in ONE process.
 *
 * `dsh web` is two halves joined by a socket — a Host listening on loopback and
 * a browser fetching it. The desktop shell removes the socket instead of
 * wrapping it: the same composed Host boots inside Electron's main process, and
 * the renderer reaches it through a custom scheme whose protocol handler is the
 * route table itself. No port is bound, so nothing on the machine (or the LAN)
 * can reach this Host but the window it belongs to.
 *
 * The composition is the shipped web tree with one row swapped — the node:http
 * carrier for the Electron one (see desktop.patch.yml). Every other row, from
 * the api gateway to the client plugin roster, mounts unchanged.
 *
 * @module @deepseek-ai/dsh-desktop
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, crashReporter, dialog, protocol, shell } from 'electron'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { WindowRecovery, type WindowFailure } from './window-recovery.ts'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the carrier's `webServer` Context declaration into this
// program. The row itself is composed by desktop.patch.yml, not imported here.
import type {} from '@deepseek-ai/dsh-host-electron-carrier'

/** The scheme the app is served from; mirrors the client's DESKTOP_SCHEME. */
const SCHEME = 'dsh'
/** Authority of the app origin — `dsh://app/...`. */
const ORIGIN = `${SCHEME}://app`
/** Event-stream paths the base client reads as SSE rather than upgrading. */
const EVENT_PATHS = ['/api/events.mux', '/api/events.host']

const here = dirname(fileURLToPath(import.meta.url))
const APP_URL = `${ORIGIN}/index.html`
const recoveries = new Map<BrowserWindow, WindowRecovery>()
let logFile: string | undefined

/** Keep native Chromium crash dumps local; this application uploads none. */
crashReporter.start({ uploadToServer: false, compress: false })

/** Record one desktop lifecycle fact locally and on stderr. */
function logDesktop(event: string, detail: string): void {
  const line = `${new Date().toISOString()} ${event} ${detail}`
  console.error(`[dsh-desktop] ${event}: ${detail}`)
  if (logFile === undefined) return
  try {
    appendFileSync(logFile, `${line}\n`, 'utf8')
  } catch (error) {
    console.error('[dsh-desktop] failed to write diagnostic log:', error)
  }
}

/** Ask what to do after bounded renderer recovery is exhausted. */
async function promptRecovery(window: BrowserWindow, failure: WindowFailure): Promise<'reload' | 'quit'> {
  const options = {
    type: 'error' as const,
    title: 'DeepSeek Harness UI stopped',
    message: 'The Harness UI could not recover, but agents may still be running.',
    detail: `${failure.kind}: ${failure.detail}\n\nDiagnostics: ${logFile ?? 'stderr'}`,
    buttons: ['Reload UI', 'Quit'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }
  const result = window.isDestroyed()
    ? await dialog.showMessageBox(options)
    : await dialog.showMessageBox(window, options)
  return result.response === 1 ? 'quit' : 'reload'
}

/**
 * Declare the app scheme before Electron starts.
 *
 * `standard` makes it a hierarchical origin (so relative URLs, module imports,
 * and `location.origin` behave like http), `secure` clears the mixed-content
 * and secure-context gates the client needs, and `stream` is what lets a
 * handler answer with an open body — the SSE downlink depends on it.
 */
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
}])

/**
 * Boot the composed Host inside this process.
 * @returns the settled root context.
 */
async function bootHost(): Promise<Context> {
  const { ctx } = await runProfile({
    environment: loadLayeredEnv('dsh'),
    profile: 'web',
    patchFiles: [join(here, '..', 'desktop.patch.yml')],
    args: [],
  })
  return ctx
}

/**
 * Route one renderer request into the in-process carrier.
 *
 * Two paths are answered ahead of the table: the event downlinks. The web
 * transport's own route refuses them with 426 because a browser is expected to
 * upgrade to a WebSocket there — a custom scheme cannot, so the desktop client
 * reads them as SSE, which the gateway's fetch handler already serves.
 * @param ctx - the booted root context.
 * @param request - the renderer's request.
 * @returns the response.
 */
async function route(ctx: Context, request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === 'GET' && EVENT_PATHS.includes(url.pathname)) {
    // Same origin rule the carrier applies; restated here because this branch
    // answers ahead of it.
    const origin = request.headers.get('origin')
    if (origin !== null && origin !== ORIGIN) return new Response('forbidden', { status: 403 })
    const apiProxy = ctx.get('apiProxy')
    if (apiProxy === undefined) return new Response('not ready', { status: 503 })
    return toFetchHandler(apiProxy).fetch(request)
  }
  return ctx.webServer.handle(request)
}

/** Open the application window on the booted Host. */
function openWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#1b1b1c',
    autoHideMenuBar: true,
    webPreferences: {
      // The renderer is the shipped web client and needs no Node: it talks to
      // the Host over the scheme, exactly as the browser build talks over HTTP.
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  const recovery = new WindowRecovery({
    now: Date.now,
    load: async () => {
      if (window.isDestroyed()) throw new Error('window was destroyed before UI recovery')
      await window.loadURL(APP_URL)
    },
    log: logDesktop,
    prompt: failure => promptRecovery(window, failure),
    quit: () => { app.quit() },
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (timer) => { clearTimeout(timer) },
  })
  recoveries.set(window, recovery)

  window.once('ready-to-show', () => { window.show() })
  window.once('close', () => { recovery.stop() })
  window.once('closed', () => {
    recovery.stop()
    recoveries.delete(window)
  })
  window.webContents.on('did-finish-load', () => { recovery.loaded() })
  window.webContents.on('did-fail-load', (_event, errorCode, description, url, isMainFrame) => {
    // Chromium reports ERR_ABORTED (-3) when a newer navigation supersedes an
    // older one. It is not a failed final document and must not start recovery.
    if (!isMainFrame || errorCode === -3) return
    recovery.report({ kind: 'load', detail: `${description} (${String(errorCode)}) at ${url}` })
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    recovery.report({ kind: 'renderer', detail: `${details.reason} (exit ${String(details.exitCode)})` })
  })
  window.webContents.on('unresponsive', () => {
    logDesktop('renderer-unresponsive', APP_URL)
  })
  window.webContents.on('responsive', () => {
    logDesktop('renderer-responsive', APP_URL)
  })
  // Anything the app points outward (provider sign-in, docs) belongs in the
  // user's real browser, not in an app window with no address bar.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  void window.loadURL(APP_URL).catch((error: unknown) => {
    recovery.report({ kind: 'load', detail: error instanceof Error ? error.message : String(error) })
  })
}

/**
 * Bring the shell up: Electron first, then the Host, then the scheme that
 * joins them — the window is opened last so it never races a route table that
 * cannot answer it yet.
 *
 * Deliberately not top-level await: the bundled host closure carries CommonJS
 * requires, and a module holding both cannot be classified.
 */
async function main(): Promise<void> {
  await app.whenReady()
  const logs = app.getPath('logs')
  try {
    mkdirSync(logs, { recursive: true })
    logFile = join(logs, 'desktop.log')
    logDesktop('diagnostics-ready', `${logFile}; crash dumps: ${app.getPath('crashDumps')}`)
  } catch (error) {
    console.error('[dsh-desktop] local diagnostics unavailable:', error)
  }

  const ctx = await bootHost()
  protocol.handle(SCHEME, request => route(ctx, request))
  openWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
  app.on('child-process-gone', (_event, details) => {
    logDesktop('child-process-gone', `${details.type}: ${details.reason} (exit ${String(details.exitCode)})`)
    if (details.type !== 'GPU' || details.reason === 'clean-exit') return
    for (const recovery of recoveries.values()) {
      recovery.report({ kind: 'gpu', detail: `${details.reason} (exit ${String(details.exitCode)})` })
    }
  })
}

app.on('before-quit', () => {
  for (const recovery of recoveries.values()) recovery.stop()
})
app.on('window-all-closed', () => { app.quit() })

main().catch((error: unknown) => {
  console.error('[dsh-desktop] failed to start:', error)
  app.exit(1)
})
