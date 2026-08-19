import { afterEach, describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LlmOAuthError } from '@deepseek-ai/dsh-llm-oauth'
import type { LlmOAuthToken } from '@deepseek-ai/dsh-llm-oauth'
import { FileOAuthTokenStore, OAUTH_DOCUMENT_VERSION } from '../src/store.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-llm-oauth-local-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return join(dir, '.oauth.json')
}

function token(overrides: Partial<LlmOAuthToken> = {}): LlmOAuthToken {
  return { access: 'access-1', refresh: 'refresh-1', expires: 1_000, ...overrides }
}

/** A store plus the routes its commits named, in commit order. */
function store(filename: string): { store: FileOAuthTokenStore; commits: string[] } {
  const commits: string[] = []
  return { store: new FileOAuthTokenStore(filename, provider => commits.push(provider)), commits }
}

describe('FileOAuthTokenStore', () => {
  it('reads nothing while the document is absent', async () => {
    const { store: subject } = store(await tempFile())
    expect(await subject.read('anthropic')).toBeUndefined()
    expect(await subject.list()).toEqual([])
  })

  it('stores a token set and reads it back with its provider-owned fields', async () => {
    const filename = await tempFile()
    const { store: subject, commits } = store(filename)
    await subject.modify('anthropic', () => Promise.resolve(token({ extra: { accountId: 'acct-7' } })))
    expect(await subject.read('anthropic')).toEqual(token({ extra: { accountId: 'acct-7' } }))
    expect(await subject.list()).toEqual(['anthropic'])
    expect(commits).toEqual(['anthropic'])
  })

  it('creates the document owner-only', async () => {
    const filename = await tempFile()
    const { store: subject } = store(filename)
    await subject.modify('anthropic', () => Promise.resolve(token()))
    expect((await stat(filename)).mode & 0o077).toBe(0)
  })

  it('sees the current token set and leaves the entry untouched when the transformation declines', async () => {
    const filename = await tempFile()
    const { store: subject, commits } = store(filename)
    await subject.modify('anthropic', () => Promise.resolve(token()))
    const seen: Array<LlmOAuthToken | undefined> = []
    const result = await subject.modify('anthropic', (current) => {
      seen.push(current)
      return Promise.resolve(undefined)
    })
    expect(seen).toEqual([token()])
    expect(result).toEqual(token())
    expect(commits).toEqual(['anthropic'])
  })

  it('serializes concurrent writers so a rotation cannot be lost', async () => {
    const filename = await tempFile()
    const { store: subject } = store(filename)
    await subject.modify('anthropic', () => Promise.resolve(token({ access: 'a0' })))
    const rotate = (next: string) => subject.modify('anthropic', current => Promise.resolve(
      token({ access: `${current?.access ?? ''}-${next}` }),
    ))
    await Promise.all([rotate('a1'), rotate('a2')])
    // Each writer observed the other's committed value rather than the value
    // that was current when both started.
    expect((await subject.read('anthropic'))?.access).toBe('a0-a1-a2')
  })

  it('keeps other routes when one is removed, and removing an absent route is a no-op', async () => {
    const filename = await tempFile()
    const { store: subject, commits } = store(filename)
    await subject.modify('anthropic', () => Promise.resolve(token()))
    await subject.modify('openai-codex', () => Promise.resolve(token({ access: 'access-2' })))
    await subject.delete('anthropic')
    await subject.delete('anthropic')
    expect(await subject.list()).toEqual(['openai-codex'])
    expect(commits).toEqual(['anthropic', 'openai-codex', 'anthropic'])
  })

  it('reads an entry missing a required field as signed out', async () => {
    const filename = await tempFile()
    await writeFile(filename, JSON.stringify({
      version: OAUTH_DOCUMENT_VERSION,
      providers: { anthropic: { access: 'a', expires: 1 }, openai: 'not-an-object' },
    }), { mode: 0o600 })
    const { store: subject } = store(filename)
    expect(await subject.read('anthropic')).toBeUndefined()
    expect(await subject.list()).toEqual([])
  })

  it('refuses a document that is not readable JSON rather than overwriting it', async () => {
    const filename = await tempFile()
    await writeFile(filename, '{ not json', { mode: 0o600 })
    const { store: subject } = store(filename)
    await expect(subject.read('anthropic')).rejects.toMatchObject({ code: 'STORE_UNREADABLE' })
    expect(await readFile(filename, 'utf8')).toBe('{ not json')
  })

  it('refuses a document written by another format version', async () => {
    const filename = await tempFile()
    await writeFile(filename, JSON.stringify({ version: 99, providers: {} }), { mode: 0o600 })
    const { store: subject } = store(filename)
    await expect(subject.read('anthropic')).rejects.toBeInstanceOf(LlmOAuthError)
  })

  it('refuses a document with no providers object', async () => {
    const filename = await tempFile()
    await writeFile(filename, JSON.stringify({ version: OAUTH_DOCUMENT_VERSION }), { mode: 0o600 })
    const { store: subject } = store(filename)
    await expect(subject.read('anthropic')).rejects.toMatchObject({ code: 'STORE_UNREADABLE' })
  })

  it('refuses a document that is not a JSON object', async () => {
    const filename = await tempFile()
    await writeFile(filename, '[]', { mode: 0o600 })
    const { store: subject } = store(filename)
    await expect(subject.read('anthropic')).rejects.toMatchObject({ code: 'STORE_UNREADABLE' })
  })

  it.skipIf(process.platform === 'win32')('refuses a document other users can read', async () => {
    const filename = await tempFile()
    await writeFile(filename, JSON.stringify({ version: OAUTH_DOCUMENT_VERSION, providers: {} }), { mode: 0o600 })
    await chmod(filename, 0o644)
    const { store: subject } = store(filename)
    await expect(subject.read('anthropic')).rejects.toMatchObject({ code: 'STORE_PERMISSIONS' })
  })

  it('keeps a route usable after a failed write', async () => {
    const filename = await tempFile()
    const { store: subject } = store(filename)
    await expect(subject.modify('anthropic', () => Promise.reject(new Error('flow failed')))).rejects.toThrow('flow failed')
    await subject.modify('anthropic', () => Promise.resolve(token()))
    expect(await subject.read('anthropic')).toEqual(token())
  })
})
