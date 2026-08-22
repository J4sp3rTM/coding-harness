/**
 * External process wait used by the A/B grader. Status comes only from
 * termination facts, never from a PASS line in stdout.
 */
import { spawn } from 'node:child_process'
import { classifyProcessCompletion, type ProcessCompletion, type ValidationClassification } from '../../src/status.ts'

/** Launch options for one validation command. */
export interface ValidationLaunch {
  /** Executable to spawn; do not pass this through a shell. */
  command: string
  /** argv after the executable. */
  args: string[]
  /** Working directory of the copied fixture. */
  cwd: string
  /** Waiter timeout in milliseconds. */
  timeoutMs: number
}

/**
 * Spawn a validation command and wait until it exits, times out, or the
 * waiter gives up. Stdout/stderr are captured as evidence. The returned
 * classification never treats a `PASS` line as success.
 * @param launch - command, cwd, and timeout.
 * @returns process facts plus the classification derived from them.
 */
export function runValidationCommand(launch: ValidationLaunch): Promise<ValidationClassification & ProcessCompletion> {
  return new Promise((resolve) => {
    const child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const finish = (facts: ProcessCompletion): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(forceTimer)
      const classified = classifyProcessCompletion({ ...facts, stdout, stderr })
      resolve({ ...facts, ...classified, stdout, stderr })
    }
    child.stdout?.on('data', (chunk: Buffer | string) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk: Buffer | string) => { stderr += String(chunk) })
    child.on('error', (error: Error) => {
      finish({
        exitCode: null,
        timedOut: false,
        cancelled: false,
        signal: null,
        stdout,
        stderr: `${stderr}${error.message}`,
      })
    })
    child.on('close', (code, signal) => {
      finish({
        exitCode: code,
        timedOut,
        cancelled: false,
        signal,
        stdout,
        stderr,
      })
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.stdout?.destroy()
      child.stderr?.destroy()
      child.kill()
    }, launch.timeoutMs)
    const forceTimer = setTimeout(() => {
      if (settled) return
      child.stdout?.destroy()
      child.stderr?.destroy()
      try { child.kill('SIGKILL') } catch { /* process may already be gone */ }
      finish({
        exitCode: null,
        timedOut: true,
        cancelled: false,
        signal: null,
        stdout,
        stderr: `${stderr}\n[waiter: process did not close after timeout]`,
      })
    }, launch.timeoutMs + 2_000)
  })
}
