import { describe, expect, it } from 'vitest'
import { classifyProcessCompletion, classifyRenderedShellResult } from '../src/status.ts'

describe('validation status classification', () => {
  it('passes only on a confirmed expected exit with no timeout or cancellation', () => {
    const passed = classifyProcessCompletion({
      exitCode: 0,
      timedOut: false,
      cancelled: false,
      signal: null,
      stdout: 'PASS\n',
      stderr: '',
    })
    expect(passed.status).toBe('passed')
    expect(passed.stdout).toBe('PASS\n')
  })

  it('does not treat a PASS line as success when the process timed out', () => {
    const result = classifyProcessCompletion({
      exitCode: 0,
      timedOut: true,
      stdout: 'PASS\n',
      stderr: '',
    })
    expect(result.status).toBe('inconclusive')
    expect(result.stdout).toBe('PASS\n')
    expect(result.reason).toContain('timed out')
  })

  it('does not treat a PASS line as success on cancellation, missing exit, or non-zero exit', () => {
    expect(classifyProcessCompletion({ exitCode: 0, cancelled: true, stdout: 'PASS' }).status).toBe('inconclusive')
    expect(classifyProcessCompletion({ exitCode: null, stdout: 'PASS' }).status).toBe('inconclusive')
    expect(classifyProcessCompletion({ exitCode: undefined, stdout: 'PASS' }).status).toBe('inconclusive')
    expect(classifyProcessCompletion({ exitCode: 1, stdout: 'PASS' }).status).toBe('failed')
    expect(classifyProcessCompletion({ exitCode: 0, signal: 'SIGTERM', stdout: 'PASS' }).status).toBe('failed')
  })

  it('classifies rendered shell output from timeout and exit markers, not a PASS body', () => {
    expect(classifyRenderedShellResult('PASS\n[timed out after 500ms]').status).toBe('inconclusive')
    expect(classifyRenderedShellResult('PASS\n[exit code: 1]').status).toBe('failed')
    expect(classifyRenderedShellResult('oops\n[killed by signal: SIGKILL]').status).toBe('failed')
    expect(classifyRenderedShellResult('PASS\n').status).toBe('passed')
    expect(classifyRenderedShellResult('(no output)\n[timed out after 100ms]\n[killed by signal: SIGTERM]').status).toBe('inconclusive')
  })
})
