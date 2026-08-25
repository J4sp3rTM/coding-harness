/**
 * Runs benchmark tasks headlessly through both harnesses and records one result
 * directory per run under benchmarks/results/.
 *
 * Usage:
 *   node benchmarks/tools/run-benchmark.mjs [--harness dsh,claude-code] [--filter <substring>]
 *       [--dataset <name>] [--reps N] [--timeout-min M] [--limit N] [--dry-prompt]
 *
 * Each run gets an isolated workspace (the task's supplied files only — never the
 * tests) plus meta.json, stdout.log, and result.json. Existing result.json files are
 * treated as completed runs, so interrupted batches resume where they stopped.
 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { DATASETS_DIR, REPO_ROOT, RESULTS_DIR, resolveOpenRouterKey, runCommand } from './lib.mjs'

function parseArgs(argv) {
  const args = { harness: 'dsh,claude-code', reps: 1, timeoutMin: 15 }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--harness') args.harness = argv[++i]
    else if (flag === '--filter') args.filter = argv[++i]
    else if (flag === '--dataset') args.dataset = argv[++i]
    else if (flag === '--reps') args.reps = Number(argv[++i])
    else if (flag === '--timeout-min') args.timeoutMin = Number(argv[++i])
    else if (flag === '--limit') args.limit = Number(argv[++i])
    else throw new Error(`unknown flag: ${flag}`)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const { readFileSync } = await import('node:fs')
const parsedManifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'))

let tasks = parsedManifest.tasks
if (args.dataset !== undefined) tasks = tasks.filter(task => task.dataset === args.dataset)
if (args.filter !== undefined) tasks = tasks.filter(task => task.id.toLowerCase().includes(args.filter.toLowerCase()))
if (args.limit !== undefined) tasks = tasks.slice(0, args.limit)
const harnesses = args.harness.split(',')

console.log(`running ${tasks.length} task(s) × ${harnesses.join(' + ')} × ${args.reps} rep(s)`)

mkdirSync(RESULTS_DIR, { recursive: true })
const openRouterKey = resolveOpenRouterKey()

for (const task of tasks) {
  const datasetDir = join(DATASETS_DIR, task.dataset, task.id)
  if (!existsSync(datasetDir)) throw new Error(`missing dataset dir for ${task.dataset}/${task.id}; re-run fetch-datasets.mjs`)
  for (const harness of harnesses) {
    for (let rep = 1; rep <= args.reps; rep += 1) {
      const runId = `${task.dataset}__${task.id}__${harness}__r${rep}`
      const runDir = join(RESULTS_DIR, runId)
      const workspace = join(runDir, 'workspace')
      if (existsSync(join(runDir, 'result.json'))) {
        console.log(`skip ${runId} (already has result.json)`)
        continue
      }
      mkdirSync(workspace, { recursive: true })
      const sourceWorkspace = join(datasetDir, task.workspaceDir)
      if (sourceWorkspace !== datasetDir) {
        cpSync(sourceWorkspace, workspace, { recursive: true })
      }

      let command
      let spawnArgs
      /** Harness-side environment; the OpenRouter key never reaches disk outside the process env. */
      let env = {}
      if (harness === 'claude-code') {
        command = 'claude'
        spawnArgs = ['-p', task.instruction, '--dangerously-skip-permissions']
        env = {
          ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
          ANTHROPIC_AUTH_TOKEN: openRouterKey,
          ANTHROPIC_MODEL: 'stealth/ox-alpha',
          CLAUDE_CONFIG_DIR: join(runDir, '.claude-home'),
        }
      } else if (harness === 'dsh') {
        command = 'node'
        // Absolute tsx specifier + pinned tsconfig: the run cwd is the task workspace,
        // where neither tsx nor the repo's path mappings would otherwise resolve.
        spawnArgs = [
          '--import', join(REPO_ROOT, 'node_modules/tsx/dist/esm/index.mjs'),
          join(REPO_ROOT, 'apps/cli/src/bin.ts'), '--profile', 'headless', task.instruction,
        ]
        env = { TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.base.json') }
      } else {
        throw new Error(`unsupported harness: ${harness}`)
      }

      console.log(`▶ ${runId}`)
      const startedAt = new Date().toISOString()
      const outcome = await runCommand(command, spawnArgs, {
        cwd: workspace,
        timeoutMs: Math.min(args.timeoutMin, Math.ceil(task.maxAgentTimeoutSec / 60)) * 60_000,
        env,
      })

      writeFileSync(join(runDir, 'stdout.log'), outcome.stdout)
      writeFileSync(join(runDir, 'stderr.log'), outcome.stderr)
      writeFileSync(join(runDir, 'meta.json'), JSON.stringify({
        runId, startedAt, harness, rep,
        task: { id: task.id, dataset: task.dataset, difficulty: task.difficulty, language: task.language, executionMode: task.executionMode },
        model: 'stealth/ox-alpha via openrouter',
        command, args: spawnArgs.map(arg => arg === env.ANTHROPIC_AUTH_TOKEN ? '<redacted>' : arg),
      }, null, 2))
      writeFileSync(join(runDir, 'result.json'), JSON.stringify({
        runId,
        taskKey: `${task.dataset}/${task.id}`,
        task: { id: task.id, dataset: task.dataset, difficulty: task.difficulty, language: task.language },
        harness, rep,
        status: outcome.status, exitCode: outcome.exitCode, durationMs: outcome.durationMs,
      }, null, 2))
      console.log(`  ${outcome.status} in ${(outcome.durationMs / 60_000).toFixed(1)} min`)
    }
  }
}
