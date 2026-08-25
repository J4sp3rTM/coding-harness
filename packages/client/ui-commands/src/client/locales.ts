/** `command` namespace dictionary (the popupSelect shell's copy). */

/** English dictionary. */
export const en = {
  'search.placeholder': 'Search…',
  'search.aria': 'Filter options',
  'status.loading': 'Loading options…',
  'status.applying': 'Applying…',
  'status.empty': 'No options',
  'overlay.aria': '/{command} options',
  'listbox.aria': '/{command} matches',
} satisfies Record<string, string>

/** The command namespace key union. */
export type CommandKey = keyof typeof en
