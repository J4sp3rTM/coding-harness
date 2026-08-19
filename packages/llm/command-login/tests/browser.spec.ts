import { describe, expect, it, vi } from 'vitest'
import { openAuthorizationUrl } from '../src/browser.ts'

const url = 'https://accounts.example.test/oauth?state=a%20b'

describe('openAuthorizationUrl', () => {
  it('uses the macOS URL opener without a shell', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
    const signal = new AbortController().signal

    await expect(openAuthorizationUrl(url, signal, { platform: 'darwin', run })).resolves.toBe(true)
    expect(run).toHaveBeenCalledWith('open', [url], signal)
  })

  it('uses the registered Windows URL handler without a shell', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })

    await expect(openAuthorizationUrl(url, new AbortController().signal, {
      platform: 'win32',
      run,
    })).resolves.toBe(true)
    expect(run).toHaveBeenCalledWith('rundll32.exe', ['url.dll,FileProtocolHandler', url], expect.any(AbortSignal))
  })

  it('uses xdg-open on a Linux desktop', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })

    await expect(openAuthorizationUrl(url, new AbortController().signal, {
      platform: 'linux',
      env: { DISPLAY: ':0' },
      osRelease: '6.8.0',
      run,
    })).resolves.toBe(true)
    expect(run).toHaveBeenCalledWith('xdg-open', [url], expect.any(AbortSignal))
  })

  it('hands WSL URLs to the Windows browser', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })

    await expect(openAuthorizationUrl(url, new AbortController().signal, {
      platform: 'linux',
      env: { WSL_INTEROP: '/run/WSL/1_interop' },
      osRelease: 'microsoft-standard-WSL2',
      run,
    })).resolves.toBe(true)
    expect(run).toHaveBeenCalledWith('rundll32.exe', ['url.dll,FileProtocolHandler', url], expect.any(AbortSignal))
  })

  it('leaves the visible link as the fallback on headless Linux', async () => {
    const run = vi.fn()

    await expect(openAuthorizationUrl(url, new AbortController().signal, {
      platform: 'linux',
      env: {},
      osRelease: '6.8.0',
      run,
    })).resolves.toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it.each(['http://accounts.example.test/oauth', 'file:///tmp/oauth', 'not a url'])(
    'rejects a non-HTTPS authorization target: %s',
    async (target) => {
      const run = vi.fn()
      await expect(openAuthorizationUrl(target, new AbortController().signal, { platform: 'darwin', run }))
        .rejects.toThrow('HTTPS')
      expect(run).not.toHaveBeenCalled()
    },
  )
})
