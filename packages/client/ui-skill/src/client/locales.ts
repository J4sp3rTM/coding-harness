/** `skill` namespace dictionaries for the dedicated tool row. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'skill'

/** English dictionary. */
export const en = {
  'row.running': 'Loading skill',
  'row.failed': 'Skill load failed',
  'row.stopped': 'Skill load stopped',
  'row.instructions': 'Instructions',
  'menu.userOnly': 'user-only',
} satisfies Record<string, string>

/** The skill namespace key union. */
export type SkillKey = keyof typeof en
