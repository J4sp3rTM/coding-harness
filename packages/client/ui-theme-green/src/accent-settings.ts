/** Green accent preference stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_ACCENT, GREEN_ACCENT_FIELD, GREEN_ACCENTS, type GreenAccentSettings,
} from './accent.ts'

export {
  DEFAULT_ACCENT, GREEN_ACCENT_FIELD, GREEN_ACCENT_SETTINGS_NAMESPACE, GREEN_ACCENTS,
  isGreenAccentId, type GreenAccentId, type GreenAccentSettings,
} from './accent.ts'

/** Durable accent schema; also the wire envelope the browser scope validates against. */
export const GreenAccentSettingsSchema: z<GreenAccentSettings> = z.object({
  [GREEN_ACCENT_FIELD]: z.union([...GREEN_ACCENTS]).default(DEFAULT_ACCENT),
})
