/**
 * Real-process half of the Win32 dialog driver: spawn the dialog child
 * process (source or built plane) and close a dialog thread's windows. The
 * module itself loads everywhere (the import chain from native-picker.ts is
 * static); what stays win32-only is koffi, imported dynamically inside the
 * bindings' functions. The driver's logic is tested against fakes of this
 * surface instead.
 */

import { spawn, type StdioOptions } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Win32DialogWorkerData } from './win32-dialog-worker.ts'

/**
 * Spawn the dialog child process. Built consumers launch the bundled CJS
 * entry next to this module under plain node; unbuilt (source) consumers
 * bootstrap tsx first, mirroring the dsh CLI's source launch. The dialog is
 * the child's first window, so Windows activates it without a foreground
 * call. Electron hosts set `ELECTRON_RUN_AS_NODE` so `process.execPath` is
 * still a Node IPC child rather than a second GUI instance.
 * @param data - the child payload (dialog title).
 * @returns the spawned child process.
 */
export function spawnDialogWorker(data: Win32DialogWorkerData): ReturnType<typeof spawn> {
  const env = dialogWorkerEnv(data.title)
  const stdio: StdioOptions = ['ignore', 'inherit', 'pipe', 'ipc']
  /* v8 ignore next 3 -- the built-output arm: tests always run unbuilt (src/) */
  if (!import.meta.url.endsWith('.ts')) {
    return spawn(process.execPath, [fileURLToPath(new URL('./worker.cjs', import.meta.url))], { env, stdio, windowsHide: true })
  }
  return spawn(process.execPath, ['--import', import.meta.resolve('tsx/esm'), fileURLToPath(new URL('./win32-dialog-worker.ts', import.meta.url))], { env, stdio, windowsHide: true })
}

/**
 * Environment inherited by the dialog child. Electron's executable starts a
 * second GUI process unless it receives `ELECTRON_RUN_AS_NODE`.
 * @param title - dialog title forwarded as `DSH_DIALOG_TITLE`.
 * @returns the child environment.
 */
export function dialogWorkerEnv(title: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, DSH_DIALOG_TITLE: title }
  if (process.versions.electron !== undefined || /(?:^|[\\/])electron(?:\.exe)?$/i.test(process.execPath)) {
    env.ELECTRON_RUN_AS_NODE = '1'
  }
  return env
}

export { closeThreadWindows } from './win32-dialog-bindings.ts'
