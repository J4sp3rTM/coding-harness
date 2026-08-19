/** Durable names and safety defaults owned by the `/rat` command. */

/** Session event carrying the current custom system-prompt value. */
export const RAT_PROMPT_EVENT = 'rat/prompt' as const
/** System-prompt section contributed by this command. */
export const RAT_SECTION_NAME = 'custom-rat'
/** System-prompt order after deployment persona and tool guidance. */
export const RAT_SECTION_ORDER = 500
/** Default maximum UTF-8 bytes accepted for one custom prompt. */
export const DEFAULT_MAX_PROMPT_BYTES = 65_536
