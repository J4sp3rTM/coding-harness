/**
 * Unknown-command adjudication for the client command surface: rank the
 * session's live catalog for near misses and render the composer's failure
 * text. Pure functions over plain data.
 * @module @deepseek-ai/dsh-client-ui-commands/src/suggest
 */

/** Maximum edit distance for a name to count as a near miss. */
const MAX_DISTANCE = 2
/** Maximum number of suggested names in one failure message. */
const MAX_SUGGESTIONS = 3

/**
 * One-row dynamic-programming Levenshtein distance.
 * @param left - candidate name typed by the user.
 * @param right - registered command name.
 * @returns the edit distance between the two names.
 */
export function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= right.length; column += 1) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- both rows contain every index through `column` by construction.
      const substitution = previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1)
      // oxlint-disable-next-line typescript/no-non-null-assertion -- both rows contain every index through `column` by construction.
      current.push(Math.min(previous[column]! + 1, current[column - 1]! + 1, substitution))
    }
    previous = current
  }
  // oxlint-disable-next-line typescript/no-non-null-assertion -- the loop guarantees the final row exists
  return previous[right.length]!
}

/**
 * Rank one session's command names for an unresolved candidate: prefix
 * matches first in name order, then near misses within {@link MAX_DISTANCE}
 * edits in distance order (equal distances preserve catalog order).
 * @param candidate - unresolved name typed after the slash.
 * @param names - the session's registered command names.
 * @returns at most {@link MAX_SUGGESTIONS} names, best first.
 */
export function suggestCommands(candidate: string, names: readonly string[]): readonly string[] {
  const lower = candidate.toLowerCase()
  const prefixes = names.filter(name => name.toLowerCase().startsWith(lower) && name.toLowerCase() !== lower)
  const near = names
    .filter(name => name.toLowerCase() !== lower && editDistance(lower, name.toLowerCase()) <= MAX_DISTANCE)
    .sort((left, right) => editDistance(lower, left.toLowerCase()) - editDistance(lower, right.toLowerCase()))
  const ranked: string[] = []
  for (const name of [...prefixes.sort(), ...near]) {
    if (!ranked.includes(name)) ranked.push(name)
    if (ranked.length === MAX_SUGGESTIONS) break
  }
  return ranked
}

/**
 * Render the composer's failure text for an unresolved slash line.
 * @param line - the exact rejected line.
 * @param candidate - the parsed candidate name, or `undefined` for malformed syntax.
 * @param names - the session's registered command names.
 * @returns the error text shown in the composer notice.
 */
export function unknownCommandText(line: string, candidate: string | undefined, names: readonly string[]): string {
  if (candidate === undefined) return `unknown or malformed command: ${line}`
  const suggestions = suggestCommands(candidate, names)
  if (suggestions.length === 0) return `unknown command: ${line}`
  const list = suggestions.map(name => `/${name}`)
  // oxlint-disable-next-line typescript/no-non-null-assertion -- the zero-length case returned above; both indexed entries therefore exist.
  const joined = list.length === 1 ? list[0]! : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]!}`
  return `unknown command: ${line} — did you mean ${joined}?`
}
