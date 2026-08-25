/** Green accent identifiers shared by the Host schema and the browser plugin. */

/** Built-in accent ids accepted at the registry and settings boundaries. */
export const GREEN_ACCENTS = ['default', 'green'] as const

/** Settings namespace owned by the green accent plugin. */
export const GREEN_ACCENT_SETTINGS_NAMESPACE = 'ui-theme-green'

/** Field carrying the selected accent. */
export const GREEN_ACCENT_FIELD = 'accent'

/** Accent persisted by the Theme Accent settings row. */
export type GreenAccentId = typeof GREEN_ACCENTS[number]

/** Default accent when the user-settings document has no override. */
export const DEFAULT_ACCENT: GreenAccentId = 'default'

/** Durable accent section shared by the Host schema and the browser scope. */
export interface GreenAccentSettings {
  /** Selected accent. */
  accent: GreenAccentId
}

/**
 * Narrow one wire or registry value to a persistable accent.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in accent.
 */
export function isGreenAccentId(value: unknown): value is GreenAccentId {
  return GREEN_ACCENTS.some(accent => accent === value)
}
