import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runBlindReviews } from '../src/reviewers.ts'

const roots: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function input() {
  const workdir = await mkdtemp(join(tmpdir(), 'dsh-reviewer-test-'))
  roots.push(workdir)
  await writeFile(join(workdir, 'CONTRACT.md'), '# Contract\nReturn the value.\n')
  await writeFile(join(workdir, 'solution.js'), 'module.exports = () => 1\n')
  await writeFile(join(workdir, 'test.js'), 'throw new Error("must stay hidden")\n')
  return {
    task: 'Implement the contract.',
    workdir,
    validation: { exitCode: 0, timedOut: false, cancelled: false, signal: null, status: 'passed' as const, reason: 'passed', stdout: '', stderr: '' },
  }
}

function review(verdict: 'pass' | 'partial', score: number) {
  return {
    verdict,
    score,
    confidence: 0.8,
    dimensions: { correctness: 4, architecture: 4, robustness: 4, maintainability: 4, efficiency: 4 },
    blockingIssues: [],
    strengths: ['clear'],
    findings: [],
  }
}

describe('blind reviewers', () => {
  it('records unavailable reviewers without inventing scores', async () => {
    const result = await runBlindReviews(await input(), '')
    expect(result.reviews.map(item => item.status)).toEqual(['failed', 'failed'])
    expect(result.reviews.map(item => item.score)).toEqual([null, null])
    expect(result.adjudication.status).toBe('not-needed')
  })

  it('runs two blind roles and adjudicates material disagreement', async () => {
    const responses = [review('pass', 88), review('partial', 60), { verdict: 'partial', score: 74, rationale: 'One edge case remains.' }]
    const prompts: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      prompts.push(typeof init?.body === 'string' ? init.body : '')
      const content = JSON.stringify(responses.shift())
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const result = await runBlindReviews(await input(), 'test-key')
    expect(result.reviews.map(item => item.role)).toEqual(['correctness', 'architecture'])
    expect(result.adjudication).toMatchObject({ triggered: true, status: 'completed', score: 74 })
    expect(prompts).toHaveLength(3)
    expect(prompts.join('\n')).not.toContain('must stay hidden')
    expect(prompts.join('\n')).not.toContain('Variant A')
    expect(prompts.join('\n')).not.toContain('DeepSeek Harness')
  })

  it('recovers reviewer JSON with trailing commas instead of dropping the score', async () => {
    const malformed = JSON.stringify(review('pass', 88)).replace(/\}$/, ',}')
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      return new Response(JSON.stringify({ choices: [{ message: { content: malformed } }] }), { status: 200 })
    }))
    const result = await runBlindReviews(await input(), 'test-key')
    expect(result.reviews.map(item => item.status)).toEqual(['completed', 'completed'])
    expect(result.reviews.every(item => item.score === 88)).toBe(true)
    expect(calls).toBe(2)
  })

  it('retries transient empty reviewer responses before succeeding', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        return new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(review('pass', 91)) } }] }), { status: 200 })
    }))
    const result = await runBlindReviews(await input(), 'test-key')
    expect(result.reviews.map(item => item.status)).toEqual(['completed', 'completed'])
    expect(result.adjudication.triggered).toBe(false)
    expect(calls).toBe(3)
  })

  it('records the last provider error after exhausting retries', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      return new Response(JSON.stringify({ error: { message: 'upstream overloaded' } }), { status: 503 })
    }))
    const result = await runBlindReviews(await input(), 'test-key')
    expect(result.reviews.map(item => item.status)).toEqual(['failed', 'failed'])
    expect(result.reviews[0]!.error).toContain('upstream overloaded')
    expect(calls).toBe(6)
  })
})
