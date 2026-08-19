/**
 * Shell-free operating-system hand-off for provider authorization URLs.
 * @module @deepseek-ai/dsh-command-login/browser
 */

import { release as osRelease } from 'node:os'
import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'

/** Injectable host facts for deterministic browser-opening tests. */
export interface AuthorizationUrlOpenerInternals {
  /** Host platform override. */
  platform?: NodeJS.Platform
  /** Environment used to detect a Linux desktop or WSL. */
  env?: NodeJS.ProcessEnv
  /** Kernel release override used to recognize WSL. */
  osRelease?: string
  /** Shell-free native command boundary. */
  run?: NativeCommandRunner
}

/** Whether an environment marker is present and non-empty. */
function present(value: string | undefined): boolean {
  return value !== undefined && value !== ''
}

/** Distinguish WSL from desktop or headless Linux. */
function isWsl(internals: AuthorizationUrlOpenerInternals): boolean {
  const env = internals.env ?? process.env
  return present(env.WSL_DISTRO_NAME)
    || present(env.WSL_INTEROP)
    || (internals.osRelease ?? osRelease()).toLowerCase().includes('microsoft')
}

/** Reject targets that must never be handed to an operating-system opener. */
function assertAuthorizationUrl(target: string): void {
  let url: URL
  try {
    url = new URL(target)
  } catch (error) {
    throw new Error('provider authorization URL must be an absolute HTTPS URL', { cause: error })
  }
  if (url.protocol !== 'https:') {
    throw new Error('provider authorization URL must be an absolute HTTPS URL')
  }
}

/**
 * Open a provider authorization page in the host's default browser.
 *
 * The target must use HTTPS. A headless Linux host returns `false`, allowing
 * the command's visible URL to remain the fallback without spawning a process
 * that cannot reach a desktop.
 * @param target - provider authorization or device-verification URL.
 * @param signal - login lifetime; cancellation terminates an in-flight launcher.
 * @param internals - platform facts and native runner for deterministic tests.
 * @returns `true` when a desktop launcher was invoked; `false` when this host has no desktop route.
 */
export async function openAuthorizationUrl(
  target: string,
  signal: AbortSignal,
  internals: AuthorizationUrlOpenerInternals = {},
): Promise<boolean> {
  assertAuthorizationUrl(target)
  const platform = internals.platform ?? process.platform
  const env = internals.env ?? process.env
  const run = internals.run ?? runNativeCommand

  if (platform === 'darwin') {
    await run('open', [target], signal)
    return true
  }
  if (platform === 'win32') {
    await run('rundll32.exe', ['url.dll,FileProtocolHandler', target], signal)
    return true
  }
  if (platform !== 'linux') return false
  if (isWsl(internals)) {
    await run('rundll32.exe', ['url.dll,FileProtocolHandler', target], signal)
    return true
  }
  if (!present(env.DISPLAY) && !present(env.WAYLAND_DISPLAY)) return false
  await run('xdg-open', [target], signal)
  return true
}
