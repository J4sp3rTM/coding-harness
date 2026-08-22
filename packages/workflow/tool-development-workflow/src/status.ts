/**
 * Validation-status classification from process completion, never from stdout.
 * @module @deepseek-ai/dsh-tool-development-workflow/status
 */

/** Terminal validation outcome used by the A/B grader and shell-result classifier. */
export type ValidationStatus = 'passed' | 'failed' | 'inconclusive'

/** Process-completion facts a grader may observe. Stdout is evidence only. */
export interface ProcessCompletion {
  /** Observed exit code; `null`/`undefined` means no confirmed status. */
  exitCode: number | null | undefined
  /** True when the waiter's own timeout fired before a confirmed exit. */
  timedOut?: boolean
  /** True when the waiter cancelled the process. */
  cancelled?: boolean
  /** Terminating signal, when the process was killed. */
  signal?: string | null
  /** Captured stdout preserved as evidence, never as the status. */
  stdout?: string
  /** Captured stderr preserved as evidence, never as the status. */
  stderr?: string
}

/** Status plus the stdout/stderr evidence that must stay separate from it. */
export interface ValidationClassification {
  /** Pass only on a confirmed successful exit. */
  status: ValidationStatus
  /** Why this status was selected. */
  reason: string
  /** Stdout evidence; never inspected for `PASS` or similar tokens. */
  stdout: string
  /** Stderr evidence. */
  stderr: string
}

/**
 * Classify a process wait. A check passes only when the process terminates
 * with the expected successful exit code (default 0) without timeout,
 * cancellation, a signal, or a missing status. Stdout/stderr are returned
 * unchanged and are not consulted.
 * @param result - observed completion facts.
 * @param expectedExitCode - successful exit code; default 0.
 * @returns status plus preserved stdout/stderr evidence.
 */
export function classifyProcessCompletion(
  result: ProcessCompletion,
  expectedExitCode = 0,
): ValidationClassification {
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const evidence = { stdout, stderr }
  if (result.cancelled === true) {
    return { status: 'inconclusive', reason: 'process was cancelled', ...evidence }
  }
  if (result.timedOut === true) {
    return { status: 'inconclusive', reason: 'process timed out before a confirmed successful exit', ...evidence }
  }
  if (result.signal !== undefined && result.signal !== null && result.signal !== '') {
    return { status: 'failed', reason: `process killed by signal ${result.signal}`, ...evidence }
  }
  if (result.exitCode === undefined || result.exitCode === null) {
    return { status: 'inconclusive', reason: 'process completed without an exit status', ...evidence }
  }
  if (result.exitCode !== expectedExitCode) {
    return { status: 'failed', reason: `process exited with code ${result.exitCode}`, ...evidence }
  }
  return {
    status: 'passed',
    reason: `process exited ${expectedExitCode} without timeout, cancellation, or a missing status`,
    ...evidence,
  }
}

/**
 * Classify a fully rendered shell-tool result string. Timeout, signal, and
 * non-zero exit markers win over any successful-looking body such as a `PASS`
 * line. A trapped timeout that later exited 0 is still inconclusive.
 * @param text - model-facing bash/pwsh renderer output.
 * @returns status plus the original text as stdout evidence.
 */
export function classifyRenderedShellResult(text: string): ValidationClassification {
  const timedOut = /\[timed out after \d+ms\]/.test(text)
  const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(text)
  const exit = /\n\[exit code: (\d+)\]$/.exec(text)
  let exitCode: number | null
  if (exit?.[1] !== undefined) exitCode = Number(exit[1])
  else if (timedOut || signal !== null) exitCode = null
  else exitCode = 0
  return classifyProcessCompletion({
    exitCode,
    timedOut,
    signal: signal?.[1] ?? null,
    stdout: text,
    stderr: '',
  })
}
