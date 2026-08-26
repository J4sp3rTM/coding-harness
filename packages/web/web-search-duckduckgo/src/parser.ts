/**
 * Pure, network-free parser for DuckDuckGo's HTML search-endpoint markup
 * (`html.duckduckgo.com/html/`). The endpoint serves server-rendered result
 * blocks with no public contract, so parsing is deliberately defensive: a
 * result whose target URL cannot be recovered is skipped rather than guessed,
 * and text is entity-decoded and tag-stripped before it reaches the seam.
 *
 * @module @deepseek-ai/dsh-web-search-duckduckgo/parser
 */

import type { WebSearchSource } from '@deepseek-ai/dsh-web'

/**
 * Parse one DuckDuckGo HTML results document into normalized sources. Results
 * are located by their `result__a` title anchor; each owns the markup that
 * follows up to the next title anchor, from which its snippet and publication
 * date are taken. Output order follows document order; duplicates by URL keep
 * their first occurrence.
 *
 * @param html - the complete response body of an HTML-endpoint results page.
 * @returns the parsed sources in document order (empty when none parse).
 */
export function parseDuckDuckGoHtml(html: string): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  const anchors = findAllTitleAnchors(html)
  for (const [index, anchor] of anchors.entries()) {
    const segmentEnd = anchors[index + 1]?.start ?? html.length
    const segment = html.slice(anchor.end, segmentEnd)
    const url = resolveTargetUrl(anchor.href)
    if (url === undefined || seen.has(url)) continue
    seen.add(url)
    const title = stripMarkup(anchor.text)
    const snippetAnchor = findFirstAnchorWithClass(segment, 'result__snippet')
    const snippet = snippetAnchor === undefined ? undefined : stripMarkup(snippetAnchor.text)
    const publishedAt = findPublishedAt(segment)
    sources.push({
      url,
      ...title.length > 0 ? { title } : {},
      ...snippet !== undefined && snippet.length > 0 ? { snippet } : {},
      ...publishedAt !== undefined ? { publishedAt } : {},
    })
  }
  return sources
}

/** One extracted `<a>` element: its attribute string and inner text. */
interface ExtractedAnchor {
  /** The anchor's raw `href` attribute value (entity-encoded), when present. */
  readonly href: string | undefined
  /** The anchor's inner markup, unmodified. */
  readonly text: string
  /** Offset of the anchor tag in the searched document. */
  readonly start: number
  /** Offset just past the anchor's closing `</a>`. */
  readonly end: number
}

/** Class token that marks every result title anchor. */
const TITLE_CLASS = 'result__a'

/** Find every result title anchor in document order. */
function findAllTitleAnchors(html: string): ExtractedAnchor[] {
  return findAllAnchorsWithClass(html, TITLE_CLASS)
}

/**
 * Find anchors carrying `classToken` as one whitespace-separated class word.
 * Matching on the token (not a substring) keeps `result__snippet` from matching
 * `result__a`-style tokens and vice versa.
 */
function findAllAnchorsWithClass(html: string, classToken: string): ExtractedAnchor[] {
  const anchors: ExtractedAnchor[] = []
  // Attribute order varies; scan every <a …> open tag and test its class list.
  const openTag = /<a\b([^>]*)>/g
  for (const match of html.matchAll(openTag)) {
    /* v8 ignore next -- the capture group is always present for this regexp. */
    const attributes = match[1] ?? ''
    if (!hasHtmlClass(attributes, classToken)) continue
    /* v8 ignore next -- String.matchAll always supplies the match offset. */
    const start = match.index
    const closeIndex = html.indexOf('</a>', start + match[0].length)
    if (closeIndex === -1) continue
    anchors.push({
      href: attributeValue(attributes, 'href'),
      text: html.slice(start + match[0].length, closeIndex),
      start,
      end: closeIndex + '</a>'.length,
    })
  }
  return anchors
}

/** Find the first anchor in `html` carrying `classToken`, or `undefined`. */
function findFirstAnchorWithClass(html: string, classToken: string): ExtractedAnchor | undefined {
  return findAllAnchorsWithClass(html, classToken)[0]
}

/** True when an attribute string declares `token` in its class list. */
function hasHtmlClass(attributes: string, token: string): boolean {
  return (attributeValue(attributes, 'class') ?? '').split(/\s+/u).includes(token)
}

/** Extract a quoted HTML attribute value, accepting either quote style. */
function attributeValue(attributes: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${escapeRegExp(name)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i').exec(attributes)?.[2]
}

/** Escape a literal for embedding in a regular expression. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A bare ISO-8601 calendar date as supplied by the endpoint's extras span. */
const PUBLISHED_AT_PATTERN = /\b(20\d{2}-\d{2}-\d{2})/

/**
 * Extract a result's publication date from its extras span, which sits between
 * the display-URL anchor and the snippet anchor. Constraining the window keeps
 * a date mentioned inside a snippet or title from being misread as metadata.
 * @param segment - the result's own markup, excluding its title anchor.
 * @returns the `YYYY-MM-DD` date, or `undefined` when the result carries none.
 */
function findPublishedAt(segment: string): string | undefined {
  const urlAnchorStart = segment.indexOf('result__url')
  if (urlAnchorStart === -1) return undefined
  const windowEnd = segment.indexOf('result__snippet', urlAnchorStart)
  const window = segment.slice(urlAnchorStart, windowEnd === -1 ? undefined : windowEnd)
  return PUBLISHED_AT_PATTERN.exec(window)?.[1]
}

/**
 * Resolve a result anchor's `href` to the real target URL. The HTML endpoint
 * routes clicks through its own redirect wrapper
 * (`//duckduckgo.com/l/?uddg=<encoded target>&rut=…`); direct absolute links
 * are passed through unchanged. Anything unrecoverable yields `undefined` so
 * the caller can skip the result.
 * @param href - the raw `href` attribute value (still entity-encoded).
 * @returns the absolute target URL string, or `undefined` when unrecoverable.
 */
export function resolveTargetUrl(href: string | undefined): string | undefined {
  if (href === undefined) return undefined
  const decodedHref = decodeEntities(href).trim()
  if (decodedHref.length === 0) return undefined
  const candidate = decodedHref.startsWith('//') ? `https:${decodedHref}` : decodedHref
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (isDuckDuckGoRedirect(url)) {
    const target = url.searchParams.get('uddg')?.trim()
    if (target === undefined || !isHttpUrl(target)) return undefined
    return target
  }
  return url.toString()
}

/** True when a decoded result target is an absolute HTTP(S) URL. */
function isHttpUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** True for the endpoint's own `/l/` click-routing wrapper URLs. */
function isDuckDuckGoRedirect(url: URL): boolean {
  const host = url.hostname.replace(/^www\./u, '')
  return host === 'duckduckgo.com' && (url.pathname === '/l/' || url.pathname === '/l')
}

/** Named entities the endpoint actually emits, beyond the numeric fallbacks. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
  nbsp: ' ',
}

/**
 * Decode HTML entities defensively: named entities the endpoint emits map to
 * their characters, in-range numeric references decode by code point, and
 * anything else (unknown names, out-of-range numbers) passes through
 * untouched — a scraping parser must not invent replacements for markup it
 * does not recognize.
 * @param input - text possibly containing entity references.
 * @returns the decoded text.
 */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, body: string) => {
    if (!body.startsWith('#')) return NAMED_ENTITIES[body] ?? entity
    const hexadecimal = body[1] === 'x' || body[1] === 'X'
    const codePoint = Number.parseInt(hexadecimal ? body.slice(2) : body.slice(1), hexadecimal ? 16 : 10)
    // fromCodePoint throws past the Unicode range; an unreplaceable reference
    // is passed through verbatim instead of aborting the parse.
    const isSurrogate = codePoint >= 0xD800 && codePoint <= 0xDFFF
    return Number.isNaN(codePoint) || codePoint > 0x10FFFF || isSurrogate ? entity : String.fromCodePoint(codePoint)
  })
}

/**
 * Reduce one element's inner markup to plain single-spaced text: tags are
 * removed and entities decoded, then runs of whitespace collapse — the seam's
 * `title`/`snippet` fields carry display text, not markup.
 * @param markup - the element's inner markup.
 * @returns the flattened text.
 */
export function stripMarkup(markup: string): string {
  return decodeEntities(markup.replace(/<[^>]*>/g, '')).replace(/\s+/gu, ' ').trim()
}
