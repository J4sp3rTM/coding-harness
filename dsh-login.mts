/**
 * Terminal sign-in for provider subscriptions, independent of any UI.
 *
 * Runs the same `ctx.llmOAuth` seam the `/login` command uses and writes the
 * token set to the same `$DSH_HOME/.oauth.json` the LLM adapter reads, so a
 * session started afterwards authenticates with the subscription.
 *
 *   node --import tsx/esm dsh-login.mts                  # list routes and their state
 *   node --import tsx/esm dsh-login.mts anthropic        # sign in
 *   node --import tsx/esm dsh-login.mts --out openai-codex   # sign out
 *
 * No browser is opened for you: the authorization URL is printed and you open
 * it yourself.
 */

import { createInterface } from 'node:readline/promises'
import { Context } from '@deepseek-ai/cordis'
import LocalLlmOAuthService from './packages/llm/llm-oauth-local/src/index.ts'
import type { LlmOAuthEvent, LlmOAuthPrompt } from './packages/llm/llm-oauth/src/index.ts'

const args = process.argv.slice(2)
const signOut = args.includes('--out')
const provider = args.find(arg => !arg.startsWith('--'))

const ctx = new Context()
await ctx.plugin(LocalLlmOAuthService, {})

if (provider === undefined) {
  console.log('Subscription routes on this machine:\n')
  for (const account of await ctx.llmOAuth.accounts()) {
    const state = account.signedIn ? 'signed in' : 'not signed in'
    console.log(`  ${account.provider.padEnd(16)} ${state.padEnd(15)} ${account.loginLabel}`)
  }
  console.log('\nSign in with:  node --import tsx/esm dsh-login.mts <route>')
  process.exit(0)
}

if (signOut) {
  await ctx.llmOAuth.logout(provider)
  console.log(`Signed out of ${provider}. The stored token is gone from this machine;`)
  console.log('the authorization itself is revoked on the provider\'s own account page.')
  process.exit(0)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })

/** Print one flow step; the authorization URL is the one that matters. */
function show(event: LlmOAuthEvent): void {
  if (event.kind === 'auth-url') {
    console.log(`\nOpen this URL in your browser:\n\n  ${event.url}\n`)
    if (event.instructions !== undefined) console.log(`${event.instructions}\n`)
    return
  }
  if (event.kind === 'device-code') {
    console.log(`\nOpen ${event.verificationUri} and enter the code ${event.userCode}\n`)
    return
  }
  console.log(event.kind === 'info' ? event.message : `... ${event.message}`)
}

/** Put one flow question to the terminal. */
async function askTerminal(prompt: LlmOAuthPrompt): Promise<string> {
  if (prompt.kind === 'select') {
    console.log(`\n${prompt.message}`)
    prompt.options.forEach((option, index) => {
      console.log(`  ${String(index + 1)}) ${option.label}`)
    })
    const picked = await rl.question('Number: ')
    const chosen = prompt.options[Number(picked.trim()) - 1] ?? prompt.options[0]!
    return chosen.id
  }
  // The loopback callback usually wins this race; the prompt is the fallback
  // for a browser on another machine, and it is abandoned when the callback
  // lands, so it must never keep the process waiting after that.
  const answer = rl.question(`${prompt.message}\n> `, { signal: prompt.signal })
  return answer.catch(() => '')
}

try {
  const account = await ctx.llmOAuth.login(provider, { notify: show, prompt: askTerminal })
  console.log(`\nSigned in to ${account.provider} (${account.loginLabel}).`)
  console.log('Requests on that route now use the subscription.')
  process.exit(0)
} catch (error) {
  console.error(`\nSign-in failed: ${(error as Error).message}`)
  process.exit(1)
}
