/**
 * File-backed durable token store for subscription sign-in, one JSON document
 * under the harness home holding one token set per provider route.
 *
 * Every read goes to the file, and every write is a read-render-commit cycle
 * under a cross-process writer lock: token rotation is a read-modify-write that
 * a second harness process, a second tab's Host, or a concurrent request can
 * enter at the same moment, and a lost update there signs the user out — the
 * refresh token a provider rotated is single-use, so overwriting it with the
 * one that was current a moment ago leaves nothing that can be exchanged again.
 *
 * The document is created and replaced at `0600` and refused outright when it
 * arrives wider, for the same reason the credentials document is: it holds
 * nothing but secrets, and serving them out of a world-readable file would make
 * the mode meaningless.
 *
 * @module dsh-llm-oauth-local/store
 */

import { readFile, stat } from 'node:fs/promises'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { LlmOAuthError } from '@deepseek-ai/dsh-llm-oauth'
import type { LlmOAuthToken, LlmOAuthTokenStore } from '@deepseek-ai/dsh-llm-oauth'

/** Document format version; a document declaring another version is refused, never migrated. */
export const OAUTH_DOCUMENT_VERSION = 1

/** Permission bits outside the owner; a token document must have none of them. */
const GROUP_OTHER_BITS = 0o077

/** The stored document: a format version and the token sets by provider route. */
interface OAuthDocument {
  version: number
  providers: Record<string, unknown>
}

/** The empty document a first write starts from. */
function emptyDocument(): OAuthDocument {
  return { version: OAUTH_DOCUMENT_VERSION, providers: {} }
}

/**
 * @param error - the thrown value to classify.
 * @returns whether it is a missing-path filesystem error.
 */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * Reject a token document other OS users can read, before its contents are
 * read at all. POSIX only: Windows has no mode to inspect — its ACLs are not
 * expressible here — so the check is skipped rather than faked.
 * @param filename - absolute path of the document.
 * @throws {LlmOAuthError} code `STORE_PERMISSIONS` when the file exists with group or other permission bits set.
 */
async function assertOwnerOnly(filename: string): Promise<void> {
  let mode: number
  try {
    mode = (await stat(filename)).mode
  } catch (error) {
    if (!isENOENT(error)) throw error
    return
  }
  /* v8 ignore next -- POSIX coverage cannot take the Windows peer; native Windows coverage does. */
  if (process.platform === 'win32') return
  /* v8 ignore start -- Windows has no POSIX mode enforcement; POSIX behavior tests enforce this peer. */
  if ((mode & GROUP_OTHER_BITS) === 0) return
  throw new LlmOAuthError(
    `llm-oauth-local: ${filename} is readable beyond its owner (mode ${(mode & 0o777).toString(8)});`
    + ` run "chmod 600 ${filename}" before starting again`,
    'STORE_PERMISSIONS',
  )
  /* v8 ignore stop */
}

/**
 * Read one entry as a token set, or nothing when the entry cannot be one.
 *
 * This is a durable-file boundary, so the fields are checked rather than
 * trusted: a hand-edited or truncated entry must read as "signed out" — which
 * a sign-in repairs — instead of reaching a provider request as a token
 * shaped like `undefined`.
 * @param entry - the parsed value stored under one provider key.
 * @returns the token set, or `undefined` when the entry is not one.
 */
function readToken(entry: unknown): LlmOAuthToken | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined
  const { access, refresh, expires, ...extra } = entry as Record<string, unknown>
  if (typeof access !== 'string' || access.length === 0) return undefined
  // Some providers issue a non-expiring access token without a refresh grant.
  // The empty string is pi-ai's explicit representation of that credential;
  // an absent or non-string field still means the durable entry is truncated.
  if (typeof refresh !== 'string') return undefined
  if (typeof expires !== 'number' || !Number.isFinite(expires)) return undefined
  return { access, refresh, expires, ...Object.keys(extra).length === 0 ? {} : { extra } }
}

/**
 * Render one token set as its stored entry, flattening the opaque
 * provider-owned fields back beside the three this seam names.
 * @param token - the token set to store.
 * @returns the entry written under the provider's key.
 */
function writeToken(token: LlmOAuthToken): Record<string, unknown> {
  return { ...token.extra, access: token.access, refresh: token.refresh, expires: token.expires }
}

/**
 * Parse the document, or start from an empty one when the file is absent.
 * A file that exists but cannot be read as this document fails loud: silently
 * treating it as empty would sign the user out and then overwrite whatever
 * they actually had.
 * @param filename - absolute path of the document.
 * @returns the parsed document.
 * @throws {LlmOAuthError} code `STORE_UNREADABLE` when the file is not this document.
 */
async function readDocument(filename: string): Promise<OAuthDocument> {
  await assertOwnerOnly(filename)
  let text: string
  try {
    text = await readFile(filename, 'utf8')
  } catch (error) {
    if (isENOENT(error)) return emptyDocument()
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new LlmOAuthError(
      `llm-oauth-local: ${filename} is not readable JSON; sign in again after removing or repairing it`,
      'STORE_UNREADABLE',
      { cause: error },
    )
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new LlmOAuthError(`llm-oauth-local: ${filename} does not hold a JSON object`, 'STORE_UNREADABLE')
  }
  // Read as unknown, not as the document: this is a durable-file boundary, so
  // the static type would be a claim about content nothing has checked yet.
  const { version, providers } = parsed as Record<'version' | 'providers', unknown>
  if (version !== OAUTH_DOCUMENT_VERSION) {
    throw new LlmOAuthError(
      `llm-oauth-local: ${filename} declares version ${String(version)}, and this build reads`
      + ` version ${OAUTH_DOCUMENT_VERSION}; remove the file and sign in again`,
      'STORE_UNREADABLE',
    )
  }
  if (typeof providers !== 'object' || providers === null) {
    throw new LlmOAuthError(`llm-oauth-local: ${filename} has no providers object`, 'STORE_UNREADABLE')
  }
  return { version, providers: providers as Record<string, unknown> }
}

/**
 * Commit the whole document, creating the harness home owner-only when missing.
 * @param filename - absolute path of the document.
 * @param document - the complete next document.
 */
async function writeDocument(filename: string, document: OAuthDocument): Promise<void> {
  await writeFileAtomic(filename, `${JSON.stringify(document, undefined, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}

/**
 * A file-backed token store.
 *
 * In-process writers queue on one promise chain per route before contending
 * for the file lock, so the common case — one Host, several requests — never
 * pays a filesystem retry, while a second process still cannot interleave.
 */
export class FileOAuthTokenStore implements LlmOAuthTokenStore {
  private readonly chains = new Map<string, Promise<unknown>>()

  /**
   * @param filename - absolute path of the token document.
   * @param onCommit - called after a write actually changed the document, for the seam's commit event.
   */
  constructor(
    private readonly filename: string,
    private readonly onCommit: (provider: string) => void,
  ) {}

  /**
   * Serialize one route's writers within this process.
   * @param provider - the provider route key whose chain the task joins.
   * @param task - the write cycle to run once the route's chain is free.
   * @returns the task's own result.
   */
  private enqueue<T>(provider: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(provider) ?? Promise.resolve()
    // Both outcomes continue the chain: a failed write must not wedge the route.
    const next = previous.then(task, task)
    this.chains.set(provider, next.then(() => undefined, () => undefined))
    return next
  }

  /**
   * Read one route's stored token set, expired or not.
   * @param provider - the provider route key.
   * @returns the stored token set, or `undefined` while signed out.
   */
  async read(provider: string): Promise<LlmOAuthToken | undefined> {
    const document = await readDocument(this.filename)
    return readToken(document.providers[provider])
  }

  /**
   * List the routes holding a readable token set.
   * @returns the provider route keys, in document order.
   */
  async list(): Promise<readonly string[]> {
    const document = await readDocument(this.filename)
    return Object.entries(document.providers)
      .filter(([, entry]) => readToken(entry) !== undefined)
      .map(([provider]) => provider)
  }

  /**
   * Apply one read-modify-write cycle to a route under its writer lock.
   * @param provider - the provider route key.
   * @param fn - the transformation; `undefined` leaves the entry untouched.
   * @returns the token set stored after the operation.
   */
  modify(
    provider: string,
    fn: (current: LlmOAuthToken | undefined) => Promise<LlmOAuthToken | undefined>,
  ): Promise<LlmOAuthToken | undefined> {
    return this.enqueue(provider, async () => {
      // The lock sibling lives beside the document, so the directory must exist
      // before a contender can create it; a first write starts from empty.
      await writeDocument(this.filename, await readDocument(this.filename))
      return withFileLock(this.filename, async () => {
        const document = await readDocument(this.filename)
        const current = readToken(document.providers[provider])
        const next = await fn(current)
        if (next === undefined) return current
        document.providers[provider] = writeToken(next)
        await writeDocument(this.filename, document)
        this.onCommit(provider)
        return next
      })
    })
  }

  /**
   * Remove one route's token set; removing an absent entry is a no-op.
   * @param provider - the provider route key.
   */
  delete(provider: string): Promise<void> {
    return this.enqueue(provider, async () => {
      const existing = await readDocument(this.filename)
      if (!(provider in existing.providers)) return
      await withFileLock(this.filename, async () => {
        const document = await readDocument(this.filename)
        if (!(provider in document.providers)) return
        const { [provider]: _removed, ...remaining } = document.providers
        await writeDocument(this.filename, { ...document, providers: remaining })
        this.onCommit(provider)
      })
    })
  }
}
