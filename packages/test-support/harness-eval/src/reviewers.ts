/** Blind OpenRouter reviewers for completed evaluation workspaces. */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { OX_ALPHA_MODEL } from './executors.ts'
import type {
  AdjudicationArtifact,
  ReviewDimensions,
  ReviewFinding,
  ReviewerArtifact,
  ValidationResult,
} from './types.ts'

const REVIEW_PROVIDER = 'openrouter-review'
const REVIEW_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const MAX_REVIEW_SOURCE_CHARS = 120_000
/** Attempts per reviewer call; provider flakes and near-miss JSON must not silently drop scores. */
const REVIEW_ATTEMPTS = 3
/** Per-attempt HTTP deadline; a stalled connection fails the attempt and the retry loop handles it. */
const REVIEW_ATTEMPT_TIMEOUT_MS = 300_000

/** Workspace and objective evidence visible to blind reviewers. */
export interface BlindReviewInput {
  task: string
  workdir: string
  validation: ValidationResult
}

/** Two independent reviews and optional disagreement adjudication. */
export interface BlindReviewResult {
  reviews: ReviewerArtifact[]
  adjudication: AdjudicationArtifact
}

interface OpenRouterChoice {
  message?: { content?: unknown }
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[]
  error?: { message?: unknown }
}

/** Joins provider content variants (plain string or text-part array) into one string. */
function contentText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const joined = content
      .map(part => typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')
      .join('')
    return joined.length > 0 ? joined : null
  }
  return null
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function finiteScore(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`reviewer returned invalid ${label}`)
  }
  return value
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new TypeError(`reviewer returned invalid ${label}`)
  return value.map(item => item as string)
}

function parseFinding(value: unknown): ReviewFinding {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('reviewer returned invalid finding')
  const record = value as Record<string, unknown>
  const severities = ['low', 'medium', 'high', 'critical'] as const
  if (!severities.includes(record.severity as typeof severities[number])) throw new TypeError('reviewer returned invalid finding severity')
  if (record.file !== null && typeof record.file !== 'string') throw new TypeError('reviewer returned invalid finding file')
  if (typeof record.description !== 'string') throw new TypeError('reviewer returned invalid finding description')
  return {
    severity: record.severity as ReviewFinding['severity'],
    file: record.file,
    description: record.description,
  }
}

function parseDimensions(value: unknown): ReviewDimensions {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('reviewer returned invalid dimensions')
  const record = value as Record<string, unknown>
  return {
    correctness: finiteScore(record.correctness, 0, 5, 'correctness dimension'),
    architecture: finiteScore(record.architecture, 0, 5, 'architecture dimension'),
    robustness: finiteScore(record.robustness, 0, 5, 'robustness dimension'),
    maintainability: finiteScore(record.maintainability, 0, 5, 'maintainability dimension'),
    efficiency: finiteScore(record.efficiency, 0, 5, 'efficiency dimension'),
  }
}

function parseJsonObject(text: string): Record<string, unknown> {
  const value = JSON.parse(text) as unknown
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('reviewer JSON must be an object')
  return value as Record<string, unknown>
}

/** Strips commas directly before a closing brace or bracket; the only near-miss this evaluator accepts. */
function withoutTrailingCommas(text: string): string {
  return text.replace(/,\s*(?=[}\]])/g, '')
}

function jsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end < start) throw new SyntaxError('reviewer returned no JSON object')
  const slice = text.slice(start, end + 1)
  try {
    return parseJsonObject(slice)
  } catch (error: unknown) {
    // Recover trailing-comma output before failing a review; schema checks below stay strict.
    try {
      return parseJsonObject(withoutTrailingCommas(slice))
    } catch {
      throw error
    }
  }
}

async function modelJson(apiKey: string, system: string, user: string): Promise<Record<string, unknown>> {
  let lastError: unknown = new Error('reviewer call was not attempted')
  for (let attempt = 0; attempt < REVIEW_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(REVIEW_ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: OX_ALPHA_MODEL,
          temperature: 0,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
        signal: AbortSignal.timeout(REVIEW_ATTEMPT_TIMEOUT_MS),
      })
      const body = await response.json() as OpenRouterResponse
      const providerMessage = typeof body.error?.message === 'string' ? body.error.message : response.statusText
      if (!response.ok) throw new Error(`OpenRouter reviewer failed (${response.status}): ${providerMessage}`)
      const content = contentText(body.choices?.[0]?.message?.content)
      if (content === null) throw new Error('OpenRouter reviewer returned no text content')
      return jsonObject(content)
    } catch (error: unknown) {
      lastError = error
    }
  }
  throw lastError
}

async function workspaceSources(root: string): Promise<string> {
  const sections: string[] = []
  let length = 0
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (length >= MAX_REVIEW_SOURCE_CHARS || entry.name === 'test.js' || entry.name === 'node_modules' || entry.name === '.git') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && /\.(?:c?js|mjs|ts|json|md)$/i.test(entry.name)) {
        const content = await readFile(path, 'utf8')
        const section = `\n--- ${relative(root, path)} ---\n${content}`
        sections.push(section.slice(0, MAX_REVIEW_SOURCE_CHARS - length))
        length += section.length
      }
    }
  }
  await visit(root)
  return sections.join('')
}

function reviewerSystem(role: ReviewerArtifact['role']): string {
  const focus = role === 'correctness'
    ? 'Prioritize requirement coverage, observable behavior, failure modes, invariants, and likely hidden edge cases.'
    : 'Prioritize modularity, responsibilities, lifecycle safety, maintainability, unnecessary complexity, and future extension.'
  return `You are an independent blind coding benchmark reviewer. ${focus} You do not know which product produced the candidate. Judge only supplied evidence. A failed validator is material but does not prevent useful partial-quality review. Return only one JSON object with verdict (pass|partial|fail|inconclusive), score (0..100), confidence (0..1), dimensions {correctness,architecture,robustness,maintainability,efficiency} each 0..5, blockingIssues string[], strengths string[], and findings [{severity:low|medium|high|critical,file:string|null,description:string}]. The whole reply must parse as that single JSON object: no prose outside it, no trailing commas, and a comma between every pair of array elements and object members. Cite concrete files and avoid stylistic preferences without practical impact.`
}

function reviewUser(input: BlindReviewInput, sources: string): string {
  const validation = {
    status: input.validation.status,
    reason: input.validation.reason,
    exitCode: input.validation.exitCode,
    stdout: input.validation.stdout.slice(0, 8_000),
    stderr: input.validation.stderr.slice(0, 12_000),
  }
  return `TASK\n${input.task}\n\nVALIDATION EVIDENCE\n${JSON.stringify(validation, null, 2)}\n\nCANDIDATE FILES${sources}`
}

function failedReview(role: ReviewerArtifact['role'], error: unknown): ReviewerArtifact {
  return {
    role,
    status: 'failed',
    provider: REVIEW_PROVIDER,
    model: OX_ALPHA_MODEL,
    verdict: 'inconclusive',
    score: null,
    confidence: null,
    dimensions: null,
    blockingIssues: [],
    strengths: [],
    findings: [],
    error: errorText(error),
  }
}

async function runReviewer(apiKey: string, role: ReviewerArtifact['role'], user: string): Promise<ReviewerArtifact> {
  try {
    const record = await modelJson(apiKey, reviewerSystem(role), user)
    const verdicts = ['pass', 'partial', 'fail', 'inconclusive'] as const
    if (!verdicts.includes(record.verdict as typeof verdicts[number])) throw new TypeError('reviewer returned invalid verdict')
    if (!Array.isArray(record.findings)) throw new TypeError('reviewer returned invalid findings')
    return {
      role,
      status: 'completed',
      provider: REVIEW_PROVIDER,
      model: OX_ALPHA_MODEL,
      verdict: record.verdict as ReviewerArtifact['verdict'],
      score: finiteScore(record.score, 0, 100, 'score'),
      confidence: finiteScore(record.confidence, 0, 1, 'confidence'),
      dimensions: parseDimensions(record.dimensions),
      blockingIssues: stringArray(record.blockingIssues, 'blockingIssues'),
      strengths: stringArray(record.strengths, 'strengths'),
      findings: record.findings.map(parseFinding),
      error: null,
    }
  } catch (error: unknown) {
    return failedReview(role, error)
  }
}

function needsAdjudication(reviews: readonly ReviewerArtifact[]): boolean {
  const completed = reviews.filter(review => review.status === 'completed' && review.score !== null)
  if (completed.length !== 2) return false
  return completed[0]?.verdict !== completed[1]?.verdict || Math.abs((completed[0]?.score ?? 0) - (completed[1]?.score ?? 0)) >= 20
}

async function adjudicate(apiKey: string, user: string, reviews: ReviewerArtifact[]): Promise<AdjudicationArtifact> {
  if (!needsAdjudication(reviews)) return { triggered: false, status: 'not-needed', provider: null, model: null, verdict: null, score: null, rationale: null, error: null }
  try {
    const record = await modelJson(
      apiKey,
      'You adjudicate disagreement between two blind coding reviewers. Reconcile only evidence-backed differences. Return only JSON with verdict (pass|partial|fail|inconclusive), score (0..100), and rationale string.',
      `${user}\n\nINDEPENDENT REVIEWS\n${JSON.stringify(reviews, null, 2)}`,
    )
    const verdicts = ['pass', 'partial', 'fail', 'inconclusive'] as const
    if (!verdicts.includes(record.verdict as typeof verdicts[number]) || typeof record.rationale !== 'string') throw new TypeError('adjudicator returned invalid result')
    return {
      triggered: true,
      status: 'completed',
      provider: REVIEW_PROVIDER,
      model: OX_ALPHA_MODEL,
      verdict: record.verdict as ReviewerArtifact['verdict'],
      score: finiteScore(record.score, 0, 100, 'adjudication score'),
      rationale: record.rationale,
      error: null,
    }
  } catch (error: unknown) {
    return { triggered: true, status: 'failed', provider: REVIEW_PROVIDER, model: OX_ALPHA_MODEL, verdict: null, score: null, rationale: null, error: errorText(error) }
  }
}

/**
 * Run two role-separated blind reviews and adjudicate material disagreement.
 * @param input Candidate workspace, task, and validation evidence.
 * @param apiKey OpenRouter credential used for reviewer requests.
 * @returns Independent reviews and any disagreement adjudication.
 */
export async function runBlindReviews(input: BlindReviewInput, apiKey = process.env.OPENROUTER_API_KEY): Promise<BlindReviewResult> {
  if (apiKey === undefined || apiKey.trim() === '') {
    const error = new Error('OPENROUTER_API_KEY is unset; blind reviews were not run')
    return {
      reviews: [failedReview('correctness', error), failedReview('architecture', error)],
      adjudication: { triggered: false, status: 'not-needed', provider: null, model: null, verdict: null, score: null, rationale: null, error: null },
    }
  }
  const sources = await workspaceSources(input.workdir)
  const user = reviewUser(input, sources)
  const reviews = await Promise.all([
    runReviewer(apiKey, 'correctness', user),
    runReviewer(apiKey, 'architecture', user),
  ])
  return { reviews, adjudication: await adjudicate(apiKey, user, reviews) }
}
