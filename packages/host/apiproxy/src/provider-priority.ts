/**
 * Host-owned provider priority for model/provider catalogs.
 *
 * The setting is intentionally a partial list: it names preferred provider ids
 * without becoming a second provider registry. Unknown ids are retained in the
 * stored preference for dormant providers and skipped until they appear.
 * @module @deepseek-ai/dsh-host-apiproxy/provider-priority
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'

/** Settings namespace for the Host-wide model/provider priority list. */
export const MODEL_PROVIDER_PRIORITY_SETTINGS_NAMESPACE = settingsNamespace('llm-provider-priority')

/** User-editable provider priority section. An absent list preserves source order. */
export interface ModelProviderPrioritySettings {
  /** Provider ids in preferred order; absent entries retain source order. */
  providers?: string[]
}

/** Schema for {@link ModelProviderPrioritySettings}; no stored value is the default. */
export const ModelProviderPrioritySettingsSchema: z<ModelProviderPrioritySettings> = z.object({
  // Preserve omission so the stored empty section remains `{}` and source order
  // stays the explicit fallback until the user chooses a priority.
  providers: z.array(z.string()).default(undefined as unknown as string[]),
})

/**
 * Validate one stored provider priority section.
 *
 * Provider ids are intentionally not checked against the live registry: a
 * dormant configurable provider may be restored before its adapter activates.
 * @param value - schema-resolved provider priority section.
 * @returns nothing when every provider id is unique, non-empty, and trimmed.
 */
export function validateModelProviderPriority(value: ModelProviderPrioritySettings): void {
  if (value.providers === undefined) return
  const seen = new Set<string>()
  for (const provider of value.providers) {
    if (provider.length === 0) throw new Error('model provider priority ids must be non-empty')
    if (provider !== provider.trim()) throw new Error('model provider priority ids must not have surrounding whitespace')
    if (seen.has(provider)) throw new Error(`model provider priority id "${provider}" is duplicated`)
    seen.add(provider)
  }
}

/**
 * Reorder provider-like entries by a partial priority list.
 * @param entries - source-ordered provider entries.
 * @param priority - saved provider ids, in preferred order.
 * @param idOf - extracts the provider id from an entry.
 * @returns entries with named ids first and the remaining source order.
 */
export function prioritizeProviders<T>(
  entries: readonly T[],
  priority: readonly string[],
  idOf: (entry: T) => string,
): T[] {
  const byId = new Map(entries.map(entry => [idOf(entry), entry] as const))
  const selected = new Set<string>()
  const ordered: T[] = []
  for (const id of priority) {
    const entry = byId.get(id)
    if (entry === undefined || selected.has(id)) continue
    selected.add(id)
    ordered.push(entry)
  }
  for (const entry of entries) {
    const id = idOf(entry)
    if (selected.has(id)) continue
    selected.add(id)
    ordered.push(entry)
  }
  return ordered
}

/**
 * Read the current provider priority from the optional settings service.
 * @param settings - composed settings provider, when available.
 * @returns the saved partial priority list, or an empty list by default.
 */
export function readModelProviderPriority(settings: SettingsProvider | undefined): readonly string[] {
  const section = settings?.get(MODEL_PROVIDER_PRIORITY_SETTINGS_NAMESPACE) as ModelProviderPrioritySettings | undefined
  return section?.providers ?? []
}

/**
 * Register the Host provider-priority namespace whenever the optional settings
 * provider is composed. `SettingsProvider.register` owns the Cordis effect, so
 * disposing the returned Host-owner fiber removes the registration and its
 * observers.
 * @param ctx - Host context owning the API gateway.
 * @returns the injected registration fiber.
 */
export function installModelProviderPriority(ctx: Context): Fiber & PromiseLike<Fiber> {
  return ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(MODEL_PROVIDER_PRIORITY_SETTINGS_NAMESPACE, ModelProviderPrioritySettingsSchema, {
      validate: validateModelProviderPriority,
    })
  })
}
