/** Shared helpers for the DSH-vs-Claude-Code real-dataset benchmark tooling. */
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BENCHMARK_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DATASETS_DIR = join(BENCHMARK_ROOT, 'datasets')
/**
 * Run records live outside the repository on purpose: an in-repo cwd would expose
 * this repo's own AGENTS.md/CLAUDE.md to both harnesses as ancestor context. The
 * home directory survives reboots, unlike /tmp which a reboot wiped mid-benchmark.
 */
export const RESULTS_DIR = process.env.DSH_BENCH_RESULTS ?? `${process.env.HOME}/dsh-bench/results`
export const REPO_ROOT = join(BENCHMARK_ROOT, '..')

/** Deterministic sampling seed; change this invalidates every frozen manifest. */
export const SAMPLE_SEED = 1337

/** mulberry32: small deterministic PRNG sufficient for reproducible shuffles. */
export function makeRng(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Seeded in-place Fisher-Yates over a copy; input order must itself be sorted for stability. */
export function seededShuffle(items, rng) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Stable content fingerprint of a directory tree: sorted relative paths + file hashes. */
export function hashDir(dir, prefix = '') {
  const hash = createHash('sha256')
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      hash.update(`d ${rel}\n`)
      hash.update(hashDir(full))
    } else {
      hash.update(`f ${rel} ${createHash('sha256').update(readFileSync(full)).digest('hex')}\n`)
    }
  }
  return hash.digest('hex')
}

/** Total size in bytes of a directory tree. */
export function dirSizeBytes(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    total += entry.isDirectory() ? dirSizeBytes(full) : statSync(full).size
  }
  return total
}

/**
 * Extracts the `instruction:` scalar from a terminal-bench task.yaml without a YAML dependency.
 * Handles both published styles: one double-quoted scalar with escaped newlines, and a
 * `|-`/`|` block scalar with uniformly indented lines. Anything else fails loud.
 */
export function readTaskInstruction(taskYamlPath) {
  const raw = readFileSync(taskYamlPath, 'utf8')
  const quoted = raw.match(/^instruction:\s*"((?:[^"\\]|\\.)*)"/m)
  if (quoted !== null) {
    // The scalar is one double-quoted YAML line whose escapes (\n, \") are JSON-compatible.
    return JSON.parse(`"${quoted[1]}"`)
  }
  const block = raw.match(/^instruction:\s*\|[+-]?\n((?:[ \t]+.*\n)*)/m)
  if (block !== null) {
    const lines = block[1].split('\n').slice(0, -1) // trailing '' from the final \n
    const indents = lines.filter(line => line.trim() !== '').map(line => line.search(/\S/))
    const indent = Math.min(...indents)
    return lines.map(line => line.slice(indent)).join('\n').trimEnd()
  }
  throw new Error(`unsupported task.yaml instruction format: ${taskYamlPath}`)
}

function readTaskField(taskYamlPath, field) {
  const match = readFileSync(taskYamlPath, 'utf8').match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))
  return match === null ? undefined : match[1]?.trim().replace(/^"|"$/g, '')
}

/** Summarizes one terminal-bench-format task directory into a manifest entry body. */
export function describeTask(sourcePath, taskId) {
  const taskYaml = join(sourcePath, 'task.yaml')
  if (!existsSync(taskYaml)) throw new Error(`missing task.yaml in ${sourcePath}`)
  const hasWorkspace = existsSync(join(sourcePath, 'workspace'))
  const hasDockerCompose = existsSync(join(sourcePath, 'docker-compose.yaml'))
  return {
    id: taskId,
    difficulty: readTaskField(taskYaml, 'difficulty') ?? 'unknown',
    category: readTaskField(taskYaml, 'category') ?? 'unknown',
    maxAgentTimeoutSec: Number(readTaskField(taskYaml, 'max_agent_timeout_sec') ?? 1800),
    workspaceDir: hasWorkspace ? 'workspace' : '.',
    runsInDocker: hasDockerCompose,
    instruction: readTaskInstruction(taskYaml),
  }
}

/**
 * Resolves the OpenRouter API key for harness auth, never logging or persisting it.
 * Prefers OPENROUTER_API_KEY from the environment, then the DSH OAuth subscription token.
 */
export function resolveOpenRouterKey() {
  if (process.env.OPENROUTER_API_KEY !== undefined && process.env.OPENROUTER_API_KEY !== '') {
    return process.env.OPENROUTER_API_KEY
  }
  const oauthPath = join(process.env.HOME ?? '', '.dsh', '.oauth.json')
  if (!existsSync(oauthPath)) {
    throw new Error('no OpenRouter credential: set OPENROUTER_API_KEY or sign in via node --import tsx/esm dsh-login.mts openrouter')
  }
  const oauth = JSON.parse(readFileSync(oauthPath, 'utf8'))
  const access = oauth.providers?.openrouter?.access
  if (typeof access !== 'string' || access === '') {
    throw new Error(`${oauthPath} has no providers.openrouter.access token`)
  }
  return access
}

/** Spawns a command capturing stdout/stderr; resolves on close with a hard timeout kill. */
export function runCommand(command, args, options) {
  const { timeoutMs = 15 * 60_000, cwd, env } = options
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ status: 'timeout', exitCode: null, stdout, stderr, durationMs: Date.now() - startedAt })
    }, timeoutMs)
    const startedAt = Date.now()
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('close', exitCode => {
      clearTimeout(timer)
      resolve({
        status: exitCode === 0 ? 'completed' : 'error',
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      })
    })
    child.on('error', error => {
      clearTimeout(timer)
      resolve({ status: 'spawn-error', exitCode: null, stdout, stderr: String(error), durationMs: Date.now() - startedAt })
    })
  })
}

/** Runs a short synchronous command and returns trimmed stdout; throws on non-zero exit. */
export function runSync(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options }).trim()
}
