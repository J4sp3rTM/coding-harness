// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppWebEntry } from '@deepseek-ai/dsh-client-web/src/boot.tsx'

let entry: AppWebEntry | undefined

afterEach(() => {
  entry?.dispose()
  entry = undefined
  document.body.textContent = ''
  delete (globalThis as typeof globalThis & { __DSH_BOOT__?: unknown }).__DSH_BOOT__
  vi.restoreAllMocks()
})

describe('AppWebEntry boot failure', () => {
  it('renders a shell-owned report when the host manifest is missing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const root = document.createElement('div')
    document.body.append(root)
    entry = new AppWebEntry(root)

    await act(async () => { await entry?.run() })

    expect(root.textContent).toContain('Failed to load plugins')
    expect(root.textContent).toContain('window.__DSH_BOOT__ is missing or not an object')
    expect(consoleError).toHaveBeenCalled()
  })
})
