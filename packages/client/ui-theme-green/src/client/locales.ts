/** `settings.themeGreen` namespace dictionaries (the Green Accent settings row's copy). */

/** English dictionary. */
export const en = {
  'accent.title': 'Theme Accent',
  'accent.default': 'Default (Blue)',
  'accent.green': 'Green (Logo)',
} satisfies Record<string, string>

/** The settings.themeGreen namespace key union. */
export type ThemeGreenKey = keyof typeof en
