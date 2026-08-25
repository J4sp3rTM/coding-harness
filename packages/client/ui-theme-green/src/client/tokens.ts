/** Logo-green overrides stacked over the built-in light/dark palettes. */

import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'

/**
 * Remap of the theme-owned blue brand scales. The presenter writes these as
 * inline custom properties on `<body>`, which beat both palette blocks in
 * `design-platform.css`, so every consumer flips — aliases that reference the
 * statics (`button-info-*`, `state-business-*`, `brand-*-new`) resolve through
 * the overridden values without their own entries here.
 */
const BLUE_SCALE_REMAP: ThemeTokenOverrides = {
  '--dsw-static-deepseek-50': { light: 'var(--dsw-static-green-100)', dark: 'var(--dsw-static-green-900)' },
  '--dsw-static-deepseek-100': { light: 'var(--dsw-static-green-100)', dark: 'var(--dsw-static-green-900)' },
  '--dsw-static-deepseek-200': { light: 'var(--dsw-static-green-300)', dark: 'var(--dsw-static-green-900)' },
  '--dsw-static-deepseek-300': { light: 'var(--dsw-static-green-300)', dark: 'var(--dsw-static-green-400)' },
  '--dsw-static-deepseek-400': { light: 'var(--dsw-static-green-400)', dark: 'var(--dsw-static-green-300)' },
  // The logo step (`#35e888`): ongoing-state dots and the brand accent ride it in both palettes.
  '--dsw-static-deepseek-450': { light: 'var(--dsw-static-green-300)', dark: 'var(--dsw-static-green-300)' },
  '--dsw-static-deepseek-500': { light: 'var(--dsw-static-green-500)', dark: 'var(--dsw-static-green-500)' },
  '--dsw-static-deepseek-600': { light: 'var(--dsw-static-green-500)', dark: 'var(--dsw-static-green-500)' },
  '--dsw-static-deepseek-700-delete': { light: 'var(--dsw-static-green-900)', dark: 'var(--dsw-static-green-900)' },
  '--dsw-static-deepseek-800': { light: 'var(--dsw-static-green-900)', dark: 'var(--dsw-static-green-900)' },
  '--dsw-static-deepseek-900': { light: 'var(--dsw-static-green-900)', dark: 'var(--dsw-static-green-900)' },
  // Categorical accents consumed directly by features (context meter tint, trajectory table).
  '--dsw-static-blue-450': { light: 'var(--dsw-static-green-400)', dark: 'var(--dsw-static-green-300)' },
  '--dsw-static-blue-500': { light: 'var(--dsw-static-green-500)', dark: 'var(--dsw-static-green-400)' },
}

/**
 * Aliases whose default values do not derive from the deepseek scale: the
 * light brand accent is a literal RGB value, dark-mode chat surfaces point at
 * neutral steps, and the hero code-chip text points at `blue-900`.
 */
const ALIAS_FIXUPS: ThemeTokenOverrides = {
  '--dsw-alias-brand-primary-new-colorprimary-new-color': {
    light: 'var(--dsw-static-green-500)',
    dark: 'var(--dsw-static-green-300)',
  },
  '--dsw-specific-bubble-highlight': { light: 'var(--dsw-static-green-100)', dark: 'var(--dsw-static-green-900)' },
  '--dsw-specific-bubble': { light: 'var(--dsw-static-green-100)', dark: 'var(--dsw-static-green-900)' },
  '--dsw-specific-sidebar-nav-item-active-accent': { light: 'var(--dsw-static-green-100)', dark: 'var(--dsw-static-green-900)' },
  '--dsw-alias-label-primary-bluish': {
    light: 'var(--dsw-static-green-900)',
    dark: 'var(--dsw-static-neutral-bluish-50)',
  },
}

/** Full logo-green overlay: blue-scale remap plus non-derived alias fixups. */
export const GREEN_TOKENS: ThemeTokenOverrides = { ...BLUE_SCALE_REMAP, ...ALIAS_FIXUPS }

/** Layer identity for the green accent override. */
export const GREEN_LAYER_SOURCE = 'ui-theme-green'
