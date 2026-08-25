import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_ACCENT, GREEN_ACCENT_SETTINGS_NAMESPACE,
} from '@deepseek-ai/dsh-client-ui-theme-green'
import { apply } from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-theme-green host', () => {
  it('registers, validates, and disposes the durable accent namespace with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(GREEN_ACCENT_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({ accent: DEFAULT_ACCENT })
    await ctx.settings.update(ns, { accent: 'green' })
    expect(ctx.settings.get(ns)).toEqual({ accent: 'green' })
    await expect(ctx.settings.update(ns, { accent: 'sepia' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('stays quiet when no settings provider exists', () => {
    apply(new Context())
    expect(true).toBe(true)
  })
})
