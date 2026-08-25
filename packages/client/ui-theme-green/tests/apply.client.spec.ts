/** ui-theme-green apply wiring: Host-backed accent, override-layer fiber
 * retract, settings-row registration, and HMR collapse recovery. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'
import { ThemeRuntime, type ThemeSettings } from '@deepseek-ai/dsh-client-ui-theme/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-theme-green/client'
import type { GreenAccentRowInjected } from '../src/client/GreenAccentRow.tsx'
import { GreenAccentRow } from '../src/client/GreenAccentRow.tsx'
import type { createGreenAccentStore } from '../src/client/settings-store.ts'
import { GREEN_ACCENT_SETTINGS_NAMESPACE } from '../src/accent.ts'
import { GreenAccentSettingsSchema } from '../src/accent-settings.ts'

const SLOT = 'settings.general.item'
const SETTINGS_NS = 'settings.themeGreen'

async function bench(isLoopback = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  ctx.provide('theme', new ThemeRuntime(ctx, stubSettingsScope<ThemeSettings>().scope))
  let accent = 'default'
  const namespace = () => ({
    ns: GREEN_ACCENT_SETTINGS_NAMESPACE,
    schema: GreenAccentSettingsSchema.toJSON(),
    value: { accent },
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  })
  const describe = vi.fn(() => Promise.resolve({
    rpcId: 'accent-describe' as never,
    result: {
      ok: true as const,
      value: { writable: true, hasDocument: true, namespaces: [namespace()] },
    },
  }))
  const mutate = vi.fn((request: { ops: { value: string }[] }) => {
    accent = request.ops[0]!.value
    return Promise.resolve({
      rpcId: 'accent-mutate' as never,
      result: { ok: true as const, value: namespace() },
    })
  })
  ctx.provide('connection', { api: { settings: { describe, mutate } }, isLoopback } as never)
  new TestRemote(ctx)
  await ctx.plugin(SettingsScopeBinder).await()
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, locale, describe, mutate,
    theme: ctx.get('theme') as ThemeRuntime,
    setHostAccent: (next: string) => { accent = next },
  }
}

function declareItems(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

function faceOf(slots: SlotRegistry) {
  const entry = slots.entries(SLOT).find(e => e.component === GreenAccentRow)!
  const handle = entry.store as ReturnType<typeof createGreenAccentStore>
  const instance = handle.create()
  const face = (entry.inject as unknown as (a: typeof instance.actions) => GreenAccentRowInjected)(instance.actions)
  return { entry, instance, face }
}

function brandToken(theme: ThemeRuntime): string | undefined {
  return theme.getTheme().active.tokens['--dsw-alias-brand-primary-new-colorprimary-new-color']
}

describe('ui-theme-green apply', () => {
  it('declares the slot, locale, settings, and theme services', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope', 'theme'])
  })

  it('registers localized copy and the row (declaration before or after apply)', async () => {
    const before = await bench()
    declareItems(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.locale.bind(SETTINGS_NS)('accent.title')).toBe('Theme Accent')
    const entry = before.slots.entries(SLOT).find(e => e.component === GreenAccentRow)!
    expect(entry.options).toMatchObject({ id: 'theme-green', order: 12 })

    const after = await bench()
    const fiber = after.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(after.slots.entries(SLOT)).toHaveLength(0)
    declareItems(after.slots)
    await Promise.resolve()
    expect(after.slots.entries(SLOT).some(e => e.component === GreenAccentRow)).toBe(true)
  })

  it('stacks the green override from the row and retracts it with the fiber', async () => {
    const b = await bench()
    declareItems(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const { instance, face } = faceOf(b.slots)
    expect(instance.getSnapshot().accent).toBe('default')
    expect(brandToken(b.theme)).toBeUndefined()

    face.setAccent('green')
    expect(instance.getSnapshot().accent).toBe('green')
    expect(brandToken(b.theme)).toBe('var(--dsw-static-green-500)')
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledOnce() })

    face.setAccent('green')
    expect(b.mutate).toHaveBeenCalledOnce()

    await fiber.dispose()
    expect(b.slots.entries(SLOT)).toHaveLength(0)
    expect(brandToken(b.theme)).toBeUndefined()
    expect(b.locale.bind(SETTINGS_NS)('accent.title')).toBe('accent.title')
  })

  it('adopts a Host accent and keeps remote browsers process-local', async () => {
    const b = await bench()
    b.setHostAccent('green')
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(brandToken(b.theme)).toBe('var(--dsw-static-green-500)') })
    const { instance } = faceOf(b.slots)
    expect(instance.getSnapshot().accent).toBe('green')

    b.setHostAccent('default')
    b.ctx.remote.$dispatch('settings/document-updated', [GREEN_ACCENT_SETTINGS_NAMESPACE, 0])
    await vi.waitFor(() => { expect(brandToken(b.theme)).toBeUndefined() })

    const remote = await bench(false)
    declareItems(remote.slots)
    await remote.ctx.plugin({ inject: [...inject], apply }).await()
    const { face } = faceOf(remote.slots)
    face.setAccent('green')
    await Promise.resolve()
    expect(remote.mutate).not.toHaveBeenCalled()
    expect(brandToken(remote.theme)).toBe('var(--dsw-static-green-500)')
  })

  it('recovers after an HMR collapse of the declaring entry', async () => {
    const b = await bench()
    const host = declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries(SLOT)).toHaveLength(1)
    host()
    expect(b.slots.entries(SLOT)).toHaveLength(0)
    declareItems(b.slots)
    await Promise.resolve()
    expect(b.slots.entries(SLOT).some(e => e.component === GreenAccentRow)).toBe(true)
  })

  it('ignores an invalid accent crossing the settings wire', async () => {
    const b = await bench()
    b.setHostAccent('sepia')
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledOnce() })
    expect(brandToken(b.theme)).toBeUndefined()
    const { instance } = faceOf(b.slots)
    expect(instance.getSnapshot().accent).toBe('default')
  })
})
