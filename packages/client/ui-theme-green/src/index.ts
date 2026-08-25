/** Host registration for the browser green-accent preference. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { GREEN_ACCENT_SETTINGS_NAMESPACE, GreenAccentSettingsSchema } from './accent-settings.ts'

export {
  DEFAULT_ACCENT, GREEN_ACCENT_FIELD, GREEN_ACCENT_SETTINGS_NAMESPACE, GREEN_ACCENTS,
  type GreenAccentId, type GreenAccentSettings,
} from './accent.ts'

/**
 * Register the durable green-accent section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(GREEN_ACCENT_SETTINGS_NAMESPACE),
      GreenAccentSettingsSchema,
    )
  })
}
