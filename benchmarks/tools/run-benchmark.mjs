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

      // Docker-mode tasks run their environment from the task's own compose file; both
      // harnesses then drive that container through `docker exec` (identical suffix below).
      const isDocker = task.executionMode === 'docker'
      let containerName = null
      if (isDocker) {
        containerName = runId.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
        mkdirSync(join(runDir, 'logs'), { recursive: true })
        mkdirSync(join(runDir, 'agent-logs'), { recursive: true })
        console.log(`  building/starting container ${containerName} …`)
        // Unique -p project per run: without it, runs of the same task share the
        // directory-derived project and replace each other's containers.
        const up = await runCommand('docker', ['compose', '-p', containerName, '-f', join(datasetDir, 'docker-compose.yaml'), 'up', '-d', '--build'], {
          timeoutMs: 30 * 60_000,
          env: {
            T_BENCH_TASK_DOCKER_CLIENT_IMAGE_NAME: `dsh-bench-${containerName}`,
            T_BENCH_TASK_DOCKER_CLIENT_CONTAINER_NAME: containerName,
            T_BENCH_TASK_LOGS_PATH: join(runDir, 'logs'),
            T_BENCH_CONTAINER_LOGS_PATH: '/logs',
            T_BENCH_TASK_AGENT_LOGS_PATH: join(runDir, 'agent-logs'),
            T_BENCH_CONTAINER_AGENT_LOGS_PATH: '/agent-logs',
            T_BENCH_TEST_DIR: '/tmp/bench-tests',
          },
        })
        if (up.status !== 'completed') {
          writeFileSync(join(runDir, 'stderr.log'), up.stderr)
          writeFileSync(join(runDir, 'result.json'), JSON.stringify({
            runId, taskKey: `${task.dataset}/${task.id}`, harness, rep,
            task: { id: task.id, dataset: task.dataset },
            status: 'container-error', durationMs: up.durationMs,
          }, null, 2))
          await runCommand('bash', ['-c', `docker rm -f $(docker ps -aq --filter 'label=com.docker.compose.project=${containerName}') 2>/dev/null; true`], { timeoutMs: 120_000 })
          continue
        }
      }

      // Identical suffix for every harness on docker-mode tasks keeps prompts comparable;
      // native tasks get the bare dataset instruction.
      const instruction = isDocker
        ? `${task.instruction}\n\n---\nEnvironment access: this task's Linux environment is a Docker container named \`${containerName}\`. The host working directory is NOT the task environment. Inspect files and run every command inside the container via:\n  docker exec ${containerName} bash -lc "<your command>"`
        : task.instruction

      let command
      let spawnArgs
      /** Harness-side environment; the OpenRouter key never reaches disk outside the process env. */
      let env = {}
      if (harness === 'claude-code') {
        command = 'claude'
        spawnArgs = ['-p', instruction, '--dangerously-skip-permissions']
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
          join(REPO_ROOT, 'apps/cli/src/bin.ts'), '--profile', 'headless', instruction,
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
        containerName,
        model: 'stealth/ox-alpha via openrouter',
        command, args: spawnArgs.map(arg => arg === env.ANTHROPIC_AUTH_TOKEN ? '<redacted>' : arg),
      }, null, 2))
      writeFileSync(join(runDir, 'result.json'), JSON.stringify({
        runId,
        taskKey: `${task.dataset}/${task.id}`,
        task: { id: task.id, dataset: task.dataset, difficulty: task.difficulty, language: task.language },
        harness, rep,
        containerName,
        status: outcome.status, exitCode: outcome.exitCode, durationMs: outcome.durationMs,
      }, null, 2))
      console.log(`  ${outcome.status} in ${(outcome.durationMs / 60_000).toFixed(1)} min`)
    }
  }
}
