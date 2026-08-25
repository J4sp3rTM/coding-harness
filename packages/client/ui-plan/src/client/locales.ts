/** `plan` namespace dictionary (the composer plan chip's copy). */

/** English dictionary. */
export const en = {
  'chip.on.aria': 'Plan mode on, press to turn off',
  'chip.on.title': 'Plan mode on — click to turn off (/plan off)',
  'chip.off.aria': 'Plan mode off, press to turn on',
  'chip.off.title': 'Plan mode off — click to turn on (/plan)',
} satisfies Record<string, string>

/** The plan namespace key union. */
export type PlanKey = keyof typeof en
