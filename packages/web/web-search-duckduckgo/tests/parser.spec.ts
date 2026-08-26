import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import { decodeEntities, parseDuckDuckGoHtml, resolveTargetUrl, stripMarkup } from '../src/parser.ts'

/** The real HTML-endpoint response recorded once from a live results page. */
const FIXTURE_HTML = readFileSync(fileURLToPath(new URL('./fixtures/ddg-html-results.html', import.meta.url)), 'utf8')

describe('parseDuckDuckGoHtml over the recorded fixture', () => {
  const sources = parseDuckDuckGoHtml(FIXTURE_HTML)

  it('parses every result block in document order', () => {
    expect(sources).toHaveLength(10)
    expect(sources[0]?.url).toBe('https://mxtoolbox.com/')
    expect(sources.map(source => source.url)).toEqual([...new Set(sources.map(source => source.url))])
  })

  it('decodes the click-routing wrapper into the real target URL', () => {
    expect(sources[0]).toMatchObject({ url: 'https://mxtoolbox.com/' })
    expect(sources[1]?.url).toBe('https://www.cloudflare.com/learning/dns/dns-records/dns-mx-record/')
  })

  it('extracts tag-stripped titles and snippets', () => {
    expect(sources[0]?.title).toBe('MX Lookup Tool - Check your DNS MX Records online - MxToolbox')
    expect(sources[0]?.snippet).toBe(
      'MX Lookup Tool lists MX records for a domain in priority order and verifies reverse DNS records,'
      + ' Open Relay and blacklist status. It also provides diagnostics, email delivery problems and login features.',
    )
  })

  it('keeps publication dates only where the endpoint supplies them', () => {
    expect(sources[0]?.publishedAt).toBeUndefined()
    const dated = sources.find(source => source.publishedAt !== undefined)
    expect(dated?.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
    expect(sources.filter(source => source.publishedAt !== undefined)).toHaveLength(4)
  })
})

describe('resolveTargetUrl', () => {
  it('passes direct absolute links through unchanged', () => {
    expect(resolveTargetUrl('https://example.com/a(b)')).toBe('https://example.com/a(b)')
    expect(resolveTargetUrl('http://example.com/x?y=1&z=2')).toBe('http://example.com/x?y=1&z=2')
  })

  it('unwraps the endpoint redirect wrapper with its encoded target', () => {
    expect(resolveTargetUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F%C3%A9&amp;rut=abc'))
      .toBe('https://example.com/é')
    expect(resolveTargetUrl('//www.duckduckgo.com/l/?uddg=http://example.com')).toBe('http://example.com')
    expect(resolveTargetUrl('https://duckduckgo.com/l?uddg=https%3A%2F%2Fexample.com')).toBe('https://example.com')
  })

  it.each([
    { href: undefined, why: 'missing href' },
    { href: '', why: 'empty href' },
    { href: '   ', why: 'whitespace-only href' },
    { href: 'not a url at all', why: 'unparseable href' },
    { href: 'javascript:alert(1)', why: 'non-http scheme' },
    { href: '//duckduckgo.com/l/?rut=abc', why: 'wrapper without an encoded target' },
    { href: '//duckduckgo.com/l/?uddg=javascript%3Aalert(1)', why: 'wrapper with a non-http target' },
    { href: '//duckduckgo.com/l/?uddg=not%20a%20url', why: 'wrapper with an invalid target' },
  ])('rejects $why', ({ href }) => {
    expect(resolveTargetUrl(href)).toBeUndefined()
  })

  it('treats a scheme-relative non-DuckDuckGo link as a direct target', () => {
    expect(resolveTargetUrl('//example.com/page')).toBe('https://example.com/page')
  })

  it('accepts single-quoted and multiline attributes in result markup', () => {
    expect(parseDuckDuckGoHtml("<a class='result__a'\n href='https://example.com/'>Example</a>"))
      .toEqual([{ url: 'https://example.com/', title: 'Example' }])
  })
})

describe('decodeEntities', () => {
  it('decodes the named entities the endpoint emits', () => {
    expect(decodeEntities('&amp;&lt;&gt;&quot;&#39;&nbsp;')).toBe('&<>"\' ')
  })

  it('decodes decimal and hexadecimal numeric references', () => {
    expect(decodeEntities('&#77;&#x4E2D;&#x2F;')).toBe('M中/')
  })

  it('leaves unrecognized references untouched', () => {
    expect(decodeEntities('&fake;&#xZZ; &amp')).toBe('&fake;&#xZZ; &amp')
  })

  it('passes out-of-range and surrogate numeric references through unreplaced', () => {
    expect(decodeEntities('&#999999999999;&#xD800;')).toBe('&#999999999999;&#xD800;')
  })
})

describe('stripMarkup', () => {
  it('removes tags, decodes entities, and collapses whitespace', () => {
    expect(stripMarkup('  <b>MX</b>  records\tfor\n <q>a</q>&nbsp;domain  ')).toBe('MX records for a domain')
  })
})

describe('parseDuckDuckGoHtml edge cases', () => {
  it('returns no sources for a document without results', () => {
    expect(parseDuckDuckGoHtml('<html><body><p>No results</p></body></html>')).toEqual([])
  })

  function source(overrides: Partial<WebSearchSource>): WebSearchSource {
    return { url: 'https://a.example/', ...overrides }
  }

  it('omits fields the markup does not carry', () => {
    const [parsed] = parseDuckDuckGoHtml(
      '<a class="result__a" href="https://bare.example/">   </a>',
    )
    expect(parsed).toEqual({ url: 'https://bare.example/' })
  })

  it('skips an anchor truncated before any closing tag', () => {
    expect(parseDuckDuckGoHtml('<a class="result__a" href="https://truncated.example/">No close'))
      .toEqual([])
  })

  it('skips an anchor whose target is unusable', () => {
    expect(parseDuckDuckGoHtml('<a class="result__a" href="nonsense">Bad</a>'))
      .toEqual([])
    expect(parseDuckDuckGoHtml('<a class="result__a" data-href="https://wrong.example/">No href</a>'))
      .toEqual([])
  })

  it('keeps the first occurrence of a duplicated target', () => {
    const html = [
      '<a class="result__a" href="https://dup.example/">First</a>',
      '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdup.example%2F">Second</a>',
    ].join('')
    expect(parseDuckDuckGoHtml(html)).toEqual([source({ url: 'https://dup.example/', title: 'First' })])
  })

  it('does not read a date mentioned inside a snippet as publication metadata', () => {
    const html = [
      '<a class="result__a" href="https://dated.example/">Title</a>',
      '<a class="result__url" href="https://dated.example/">dated.example</a>',
      '<a class="result__snippet" href="https://dated.example/">updated 2020-01-01 forever</a>',
    ].join('')
    expect(parseDuckDuckGoHtml(html)).toEqual([source({
      url: 'https://dated.example/',
      title: 'Title',
      snippet: 'updated 2020-01-01 forever',
    })])
  })

  it('reads the extras-span date even when the result carries no snippet', () => {
    const html = [
      '<a class="result__a" href="https://dated.example/">Title</a>',
      '<div class="result__extras"><a class="result__url" href="https://dated.example/">dated.example</a>',
      '<span>&nbsp; 2019-12-31T00:00:00.0000000</span></div>',
    ].join('')
    expect(parseDuckDuckGoHtml(html)).toEqual([source({
      url: 'https://dated.example/',
      title: 'Title',
      publishedAt: '2019-12-31',
    })])
  })
})
