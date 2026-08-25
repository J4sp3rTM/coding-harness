/**
 * Browser green-accent plugin over ThemeRuntime's override layer. The Host
 * settings scope stores the accent; apply stacks logo-green alias tokens when
 * the durable value is `green` and retracts them with the plugin fiber.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ctx.settingsScope Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the theme's Context merge (ctx.theme).
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { GreenAccentRowInjected } from './GreenAccentRow.tsx'
import { GreenAccentRow } from './GreenAccentRow.tsx'
import { createGreenAccentStore } from './settings-store.ts'
import { en, type ThemeGreenKey } from './locales.ts'
import { GREEN_LAYER_SOURCE, GREEN_TOKENS } from './tokens.ts'
import {
  DEFAULT_ACCENT, GREEN_ACCENT_FIELD, GREEN_ACCENT_SETTINGS_NAMESPACE,
  isGreenAccentId, type GreenAccentId, type GreenAccentSettings,
} from '../accent.ts'

export type { GreenAccentRowComponentProps, GreenAccentRowInjected } from './GreenAccentRow.tsx'
export type { GreenAccentState } from './settings-store.ts'
export type { ThemeGreenKey } from './locales.ts'
export type { GreenAccentId, GreenAccentSettings } from '../accent.ts'

/** Namespace owning this feature's settings-row copy. */
const SETTINGS_NS = 'settings.themeGreen'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Green Accent settings row's copy. */
    'settings.themeGreen': ThemeGreenKey
  }
}

/** Required services: settings transport plus slots/locale for the Accent row. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope', 'theme']

/**
 * Client plugin body: adopt the Host accent, stack the green override as a
 * fiber effect, and register the Theme Accent settings row.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const host = ctx.settingsScope.bind<GreenAccentSettings>({
    namespace: GREEN_ACCENT_SETTINGS_NAMESPACE,
  })
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { en }), 'ui-theme-green: settings row dictionaries')

  const store = createGreenAccentStore()
  let bound: BoundActions<typeof store> | undefined
  let revision = 0
  let accent = readAccent(host)
  /** Live override disposer owned by the plugin fiber. */
  let layer: (() => void) | undefined

  const sync = (): void => {
    bound?.sync(accent, revision)
  }

  const project = (next: GreenAccentId): void => {
    layer?.()
    layer = next === 'green' ? ctx.theme.overrideTokens(GREEN_LAYER_SOURCE, GREEN_TOKENS) : undefined
  }

  ctx.effect(() => {
    project(accent)
    return () => {
      layer?.()
      layer = undefined
    }
  }, 'ui-theme-green: accent override layer')

  const adopt = (): void => {
    const next = readAccent(host)
    if (next === accent) return
    accent = next
    revision += 1
    project(accent)
    sync()
  }
  ctx.effect(() => host.subscribe(adopt), 'ui-theme-green: settings scope adoption')
  adopt()

  const injected = (actions: BoundActions<typeof store>): GreenAccentRowInjected => {
    bound = actions
    sync()
    return {
      setAccent: (id) => {
        if (accent === id) return
        accent = id
        revision += 1
        project(id)
        void host.set(GREEN_ACCENT_FIELD, id)
        sync()
      },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'theme-green',
    order: 12,
    store,
    locale: SETTINGS_NS,
    inject: injected,
  }, GreenAccentRow))
}

/** Read the accepted durable accent, or the schema default. */
function readAccent(host: SettingsScope<GreenAccentSettings>): GreenAccentId {
  const value = host.getSnapshot().value?.accent
  return isGreenAccentId(value) ? value : DEFAULT_ACCENT
}
