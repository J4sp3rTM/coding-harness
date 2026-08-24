import { describe, expect, it } from 'vitest'

interface OAuthPageModule {
  /** Render the provider callback success page. */
  oauthSuccessHtml(message: string): string
  /** Render the provider callback failure page. */
  oauthErrorHtml(message: string, details?: string): string
}

/** Load the exact private pi-ai renderer exercised by its loopback OAuth flows. */
async function pages(): Promise<OAuthPageModule> {
  const entry = import.meta.resolve('@earendil-works/pi-ai')
  const page = new URL('./auth/oauth/oauth-page.js', entry)
  return import(page.href) as Promise<OAuthPageModule>
}

describe('patched pi-ai OAuth callback page', () => {
  it('renders the Harness-branded success state and escapes provider text', async () => {
    const html = (await pages()).oauthSuccessHtml('OpenAI <ready>')

    expect(html).toContain('<title>Authentication successful · Conduit</title>')
    expect(html).toContain('data-state="success"')
    expect(html).toContain('Conduit')
    expect(html).toContain('OpenAI &lt;ready&gt;')
    expect(html).not.toContain('OpenAI <ready>')
    expect(html).not.toContain('<script')
    expect(html).not.toMatch(/\b(?:src|href)=/)
  })

  it('renders escaped failure details with the error treatment', async () => {
    const html = (await pages()).oauthErrorHtml('Could not sign in', '<token>')

    expect(html).toContain('data-state="error"')
    expect(html).toContain('&lt;token&gt;')
    expect(html).not.toContain('<token>')
  })
})
