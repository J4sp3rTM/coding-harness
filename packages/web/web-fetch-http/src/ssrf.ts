/**
 * Private-network (SSRF) targeting checks for the local HTTP(S) fetch provider —
 * the pure, network-free half. The provider runs them against every request
 * target before connecting: hostname rules first, then IP-literal range
 * checks, then a caller-supplied DNS resolution whose every resolved address
 * is fed back through the same checks. Only the LOOPBACK class can be waived,
 * and only by explicit config (loopback fixture servers and local
 * development); every other blocked class is unconditional.
 *
 * @module @deepseek-ai/dsh-web-fetch-http/ssrf
 */

import { WebError } from '@deepseek-ai/dsh-web'

/** Hostnames that name the local machine rather than a routable peer. */
const LOOPBACK_HOSTNAME = /^localhost$/u

/** Hostname forms under the local machine's name (`*.localhost`). */
const LOOPBACK_SUBDOMAIN = /\.localhost$/

/** Hostname suffix of the link-local mDNS space. */
const LOCAL_SUFFIX = /\.local$/

/**
 * Throw {@link WebError} `WEB_BLOCKED_URL` when a request target's hostname is
 * a non-routable name: the machine itself (`localhost`, `*.localhost` — the
 * loopback class {@link allowLoopback} may waive) or a `.local` mDNS name
 * (never waivable). Called before any DNS work so a blocked name costs no
 * resolution.
 * @param url - the parsed request target.
 * @param allowLoopback - whether the loopback hostname class is waived.
 * @returns the lower-cased hostname when it may proceed to address checking.
 */
export function assertPublicHostname(url: URL, allowLoopback: boolean): string {
  const hostname = url.hostname.replace(/\.+$/u, '').toLowerCase()
  if (LOOPBACK_HOSTNAME.test(hostname) || LOOPBACK_SUBDOMAIN.test(hostname)) {
    if (!allowLoopback) throw blocked(url, `"${url.hostname}" names the loopback host`)
  } else if (LOCAL_SUFFIX.test(hostname)) {
    throw blocked(url, `"${url.hostname}" is a local-network (.local) name`)
  }
  return hostname
}

/**
 * True when a lower-cased hostname is an address literal rather than a name to
 * resolve: an IPv4 dotted quad or anything containing `:` (IPv6).
 * @param hostname - the lower-cased hostname from {@link assertPublicHostname}.
 * @returns true when no DNS resolution applies.
 */
export function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/u.test(hostname) || hostname.includes(':')
}

/**
 * Throw {@link WebError} `WEB_BLOCKED_URL` when an address lies in a blocked
 * range. Blocked classes: IPv4 loopback (127.0.0.0/8), this-network
 * (0.0.0.0/8), private 10/8, 172.16/12, 192.168/16, link-local 169.254/16
 * (including cloud metadata 169.254.169.254); IPv6 loopback (::1),
 * unspecified (::), unique-local (fc00::/7), link-local (fe80::/10), and
 * IPv4-mapped addresses whose embedded IPv4 part is blocked. Only loopback
 * members are waivable, and only by {@link allowLoopback}.
 * @param address - one resolved or literal address; IPv6 literals may still
 *   carry their URL-form brackets.
 * @param allowLoopback - whether the loopback classes are waived.
 */
export function assertAddressAllowed(address: string, allowLoopback: boolean): void {
  // WHATWG URL.hostname keeps IPv6 brackets ('http://[::1]/' → '[::1]').
  const literal = address.replace(/^\[/u, '').replace(/\]$/u, '').toLowerCase()
  const reason = literal.includes(':')
    ? ipv6BlockReason(parseIPv6(literal), allowLoopback)
    : ipv4BlockReason(literal, allowLoopback)
  if (reason !== undefined) {
    throw new WebError(`blocked private-network fetch target ${literal}: ${reason}`, 'WEB_BLOCKED_URL')
  }
}

/** The blocked-range reason for an IPv4 literal, or `undefined` when public. */
function ipv4BlockReason(literal: string, allowLoopback: boolean): string | undefined {
  const parts = literal.split('.')
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/u.test(part) || Number(part) > 255)) return undefined
  let value = 0
  for (const part of parts) value = value * 256 + Number(part)
  const topByte = Math.floor(value / 0x1000000)
  const secondByte = Math.floor(value / 0x10000) % 256
  if (topByte === 127) return allowLoopback ? undefined : 'IPv4 loopback (127.0.0.0/8)'
  if (topByte === 0) return 'this-network (0.0.0.0/8)'
  if (topByte === 10) return 'private range (10.0.0.0/8)'
  if (topByte === 172 && secondByte >= 16 && secondByte <= 31) return 'private range (172.16.0.0/12)'
  if (topByte === 192 && secondByte === 168) return 'private range (192.168.0.0/16)'
  if (topByte === 169 && secondByte === 254) return 'link-local (169.254.0.0/16)'
  return undefined
}

/** The blocked-range reason for a parsed IPv6 address, or `undefined`. */
function ipv6BlockReason(groups: readonly number[] | undefined, allowLoopback: boolean): string | undefined {
  // Not an IPv6 literal: nothing this checker decides (the URL constructor
  // rejects malformed literals before transport).
  /* v8 ignore next -- malformed IPv6 never reaches this helper from URL parsing. */
  if (groups === undefined) return undefined
  // IPv4-mapped (::ffff:a.b.c.d): the embedded IPv4 address decides.
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
    /* v8 ignore next -- a valid mapped literal always expands to eight groups. */
    const high = groups[6] ?? 0
    /* v8 ignore next -- a valid mapped literal always expands to eight groups. */
    const low = groups[7] ?? 0
    const mapped = ((high << 16) >>> 0) | low
    const quad = [mapped >>> 24 & 0xff, mapped >>> 16 & 0xff, mapped >>> 8 & 0xff, mapped & 0xff].join('.')
    return ipv4BlockReason(quad, allowLoopback)
  }
  if (groups.every(group => group === 0)) return 'unspecified address (::)'
  if (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1) {
    return allowLoopback ? undefined : 'IPv6 loopback (::1)'
  }
  /* v8 ignore next -- a valid IPv6 literal always has a first group. */
  const first = groups[0] ?? 0
  if ((first & 0xfe00) === 0xfc00) return 'unique-local (fc00::/7)'
  if ((first & 0xffc0) === 0xfe80) return 'link-local (fe80::/10)'
  return undefined
}

/**
 * Parse an IPv6 literal (lower-cased, brackets stripped, zone id tolerated)
 * into its eight 16-bit groups. Accepts the embedded-IPv4 tail form
 * (`::ffff:127.0.0.1`). Returns `undefined` when the input is not an IPv6
 * literal at all.
 * @param hostname - the lower-cased candidate literal.
 * @returns the eight groups in network order, or `undefined`.
 */
export function parseIPv6(hostname: string): readonly number[] | undefined {
  /* v8 ignore next -- split() always returns an element at index zero. */
  const withoutZone = hostname.split('%', 1)[0] ?? hostname
  if (!withoutZone.includes(':')) return undefined
  const halves = withoutZone.split('::')
  if (halves.length > 2) return undefined
  /* v8 ignore next -- split() always returns an element at index zero. */
  const headParts = halves[0] ?? ''
  /* v8 ignore next -- a two-part split always has a right-hand element. */
  const tailParts = halves.length === 2 ? halves[1] ?? '' : undefined
  const head = headParts === '' ? [] : headParts.split(':')
  const tail = tailParts === undefined || tailParts === '' ? [] : tailParts.split(':')
  if (halves.length === 1 && head.length !== 8) return undefined
  const headGroups = groupsOf(head)
  const tailGroups = groupsOf(tail)
  if (headGroups === undefined || tailGroups === undefined) return undefined
  const missing = 8 - headGroups.length - tailGroups.length
  // A '::' must stand for at least one group; a full form must have exactly 8.
  if (missing < 0 || halves.length === 2 && missing === 0) return undefined
  return [...headGroups, ...Array<number>(halves.length === 2 ? missing : 0).fill(0), ...tailGroups]
}

/** Parse colon-separated groups, accepting one trailing embedded IPv4 quad. */
function groupsOf(parts: readonly string[]): readonly number[] | undefined {
  const groups: number[] = []
  for (const [index, part] of parts.entries()) {
    const isLast = index === parts.length - 1
    if (isLast && /^\d{1,3}(\.\d{1,3}){3}$/u.test(part)) {
      const [a = 0, b = 0, c = 0, d = 0] = part.split('.').map(Number)
      groups.push((a << 8) + b, (c << 8) + d)
      continue
    }
    if (!/^[0-9a-f]{1,4}$/u.test(part)) return undefined
    groups.push(Number.parseInt(part, 16))
  }
  return groups
}

/** Build the `WEB_BLOCKED_URL` error for a blocked non-routable hostname. */
function blocked(url: URL, reason: string): WebError {
  return new WebError(`blocked fetch target ${url.origin}: ${reason}`, 'WEB_BLOCKED_URL')
}
