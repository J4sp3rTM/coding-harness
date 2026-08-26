import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as duckduckgoPlugin from '@deepseek-ai/dsh-web-search-duckduckgo'

let server: Server

afterEach(async () => {
  if (server === undefined) return
  await new Promise<void>(resolve => server.close(() => { resolve() }))
})

/** Mount the web seam plus the DuckDuckGo plugin over one local endpoint. */
async function mount(pluginConfig: Record<string, unknown> = {}) {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, { searchProviders: ['deepseek-official', 'duckduckgo'] })
  // A credentialed stand-in for deepseek-official that is registered but
  // unavailable: the fallback must walk past it to the keyless provider.
  ctx.web.registerSearchProvider({
    id: 'deepseek-official',
    available: () => false,
    search: () => Promise.reject(new Error('unavailable stand-in must not be called')),
  })
  if (pluginConfig.baseURL === undefined) {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<a class="result__a" href="https://mounted.example/">Mounted</a>')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    pluginConfig.baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  }
  const fiber = await ctx.plugin(duckduckgoPlugin, pluginConfig)
  return { ctx, fiber }
}

describe('web-search-duckduckgo plugin registration', () => {
  it('registers the keyless provider into ctx.web and serves a search through the fallback list', async () => {
    const { ctx } = await mount()
    const result = await ctx.web.search({ query: 'q' })
    expect(result.sources[0]).toMatchObject({ url: 'https://mounted.example/', title: 'Mounted' })
  })

  it('disposes the registration with its fiber (HMR safety)', async () => {
    const { ctx, fiber } = await mount()
    // The second registration is observable through a duplicate-id rejection.
    expect(() => ctx.web.registerSearchProvider(new duckduckgoPlugin.DuckDuckGoSearchProvider({
      baseURL: 'https://html.duckduckgo.test/html/',
      maxResponseBytes: 1000,
    }))).toThrow(expect.objectContaining({ code: 'WEB_DUPLICATE_PROVIDER' }))
    await fiber.dispose()
    expect(() => ctx.web.registerSearchProvider(new duckduckgoPlugin.DuckDuckGoSearchProvider({
      baseURL: 'https://html.duckduckgo.test/html/',
      maxResponseBytes: 1000,
    }))).not.toThrow()
  })

  it('rejects an unparseable baseURL at load instead of registering a broken provider', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, {})
    await expect(ctx.plugin(duckduckgoPlugin, { baseURL: 'not a url' }))
      .rejects.toThrow(/config\.baseURL "not a url" is not a parsable URL/)
    await expect(ctx.plugin(duckduckgoPlugin, { baseURL: '' }))
      .rejects.toThrow(/config\.baseURL "" is not a parsable URL/)
  })

  it.each([
    [0],
    [-5],
    [1.5],
  ])('rejects maxResponseBytes %s through the schema at load', async (maxResponseBytes) => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, {})
    await expect(ctx.plugin(duckduckgoPlugin, { baseURL: 'https://html.duckduckgo.com/html/', maxResponseBytes }))
      .rejects.toThrow(/invalid config[\s\S]*maxResponseBytes/)
  })

  it('re-checks both fields when apply() is called directly without the Loader', () => {
    // Direct callers bypass the Loader's schema validation; the fail-loud
    // contract must not depend on that parse step.
    const register = vi.fn()
    const ctx = { web: { registerSearchProvider: register } } as unknown as Context
    expect(() => { duckduckgoPlugin.apply(ctx, { baseURL: 'not a url', maxResponseBytes: 10 }) })
      .toThrow(/config\.baseURL "not a url" is not a parsable URL/)
    expect(() => { duckduckgoPlugin.apply(ctx, { baseURL: 'https://html.duckduckgo.com/html/', maxResponseBytes: 1.5 }) })
      .toThrow(/maxResponseBytes must be a positive integer/)
    duckduckgoPlugin.apply(ctx, { baseURL: 'https://html.duckduckgo.com/html/', maxResponseBytes: 10 })
    duckduckgoPlugin.apply(ctx, {})
    expect(register).toHaveBeenCalledTimes(2)
  })

  it('defaults the endpoint and byte cap in the schema the Loader renders', () => {
    expect(duckduckgoPlugin.Config({})).toEqual({
      baseURL: 'https://html.duckduckgo.com/html/',
      maxResponseBytes: 2_000_000,
    })
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in duckduckgoPlugin).toBe(false)
  })
})
