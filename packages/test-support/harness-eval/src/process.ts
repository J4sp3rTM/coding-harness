/** Process waiter and completion-based validation classifier for A/B tests. */
import { spawn } from 'node:child_process'
import type { ProcessCompletion, ValidationClassification, ValidationResult } from './types.ts'

export type { ProcessCompletion, ValidationClassification, ValidationResult }

/** Launch options for one validation command. */
export interface ValidationLaunch {
  command: string
  args: string[]
  cwd: string
  timeoutMs: number
}

/**
 * Classify a process wait. A check passes only after a confirmed successful
 * exit; stdout and stderr are retained as evidence and never inspected.
 * @param result - observed process completion facts.
 * @param expectedExitCode - successful exit code, normally zero.
 * @returns completion-based status and preserved output evidence.
 */
export function classifyProcessCompletion(result: ProcessCompletion, expectedExitCode = 0): ValidationClassification {
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const evidence = { stdout, stderr }
  if (result.cancelled === true) return { status: 'inconclusive', reason: 'process was cancelled', ...evidence }
  if (result.timedOut === true) return { status: 'inconclusive', reason: 'process timed out before a confirmed successful exit', ...evidence }
  if (result.signal !== undefined && result.signal !== null && result.signal !== '') {
    return { status: 'failed', reason: `process killed by signal ${result.signal}`, ...evidence }
  }
  if (result.exitCode === undefined || result.exitCode === null) {
    return { status: 'inconclusive', reason: 'process completed without an exit status', ...evidence }
  }
  if (result.exitCode !== expectedExitCode) {
    return { status: 'failed', reason: `process exited with code ${result.exitCode}`, ...evidence }
  }
  return { status: 'passed', reason: `process exited ${expectedExitCode} without timeout, cancellation, or a missing status`, ...evidence }
}

/**
 * Spawn a validation command without a shell and wait for its terminal event.
 * @param launch - executable, arguments, workspace, and timeout.
 * @returns process facts and status derived from those facts.
 */
export function runValidationCommand(launch: ValidationLaunch): Promise<ValidationResult> {
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
    const timer = setTimeout(() => {
      timedOut = true
      child.stdout.destroy()
      child.stderr.destroy()
      child.kill()
    }, launch.timeoutMs)
    const forceTimer = setTimeout(() => {
      if (settled) return
      child.stdout.destroy()
      child.stderr.destroy()
      try { child.kill('SIGKILL') } catch { /* the process may already have closed */ }
      finish({ exitCode: null, timedOut: true, cancelled: false, signal: null })
    }, launch.timeoutMs + 2_000)
    const finish = (facts: ProcessCompletion): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(forceTimer)
      const completion = { ...facts, stdout, stderr }
      resolve({ ...completion, ...classifyProcessCompletion(completion) })
    }
    child.stdout.on('data', (chunk: Buffer | string) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk: Buffer | string) => { stderr += String(chunk) })
    child.on('error', (error: Error) => {
      finish({
        exitCode: null,
        timedOut: false,
        cancelled: false,
        signal: null,
        stderr: `${stderr}${error.message}`,
      })
    })
    child.on('close', (code, signal) => {
      finish({
        exitCode: code,
        timedOut,
        cancelled: false,
        signal,
      })
    })
  })
}
