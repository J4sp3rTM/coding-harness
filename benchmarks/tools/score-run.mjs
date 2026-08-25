/**
 * Scores recorded benchmark runs against each dataset's own tests.
 *
 * Native datasets (aider-polyglot): the task's tests/ directory is copied into a
 * scoring copy of the run workspace (tests were never visible to the agent) and the
 * language's standard test runner decides pass/fail by exit code.
 *
 * Docker-mode tasks (terminal-bench-core, swebench-verified) are marked
 * `requires-docker` until run on a Docker host via terminal-bench's own runner.
 *
 * Usage:
 *   node benchmarks/tools/score-run.mjs [<runId-substring>]   # default: all runs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import { DATASETS_DIR, RESULTS_DIR, runCommand } from './lib.mjs'

const PYTEST_VENV = '/tmp/dsh-bench-pytest-venv'

async function ensurePytestVenv() {
  if (!existsSync(join(PYTEST_VENV, 'bin', 'pytest'))) {
    console.log('creating pytest venv for scoring …')
    await runCommand('python3', ['-m', 'venv', PYTEST_VENV], { timeoutMs: 120_000 })
    const pip = await runCommand(join(PYTEST_VENV, 'bin', 'pip'), ['install', '--quiet', 'pytest'], { timeoutMs: 300_000 })
    if (pip.status !== 'completed') throw new Error(`pytest install failed: ${pip.stderr}`)
  }
  return join(PYTEST_VENV, 'bin', 'pytest')
}

/** Per-language native test invocation; mirrors what the packaged run-tests.sh does in-container. */
async function scoreNative(taskDir, workspace, language) {
  const testsSource = join(taskDir, 'tests')
  if (!existsSync(testsSource)) return { status: 'unsupported', detail: 'no tests dir' }
  const scoringDir = `${workspace}-scored`
  rmSync(scoringDir, { recursive: true, force: true })
  cpSync(workspace, scoringDir, { recursive: true })

  let command
  let args
  let timeoutMs = 10 * 60_000
  if (language === 'python') {
    const pytest = await ensurePytestVenv()
    cpSync(testsSource, join(scoringDir, 'tests'), { recursive: true })
    command = pytest
    args = ['-q', join(scoringDir, 'tests')]
  } else if (language === 'javascript') {
    cpSync(testsSource, join(scoringDir, 'tests'), { recursive: true })
    if (!existsSync(join(scoringDir, 'package.json'))) {
      writeFileSync(join(scoringDir, 'package.json'), JSON.stringify({
        name: 'exercism-test', version: '1.0.0',
        scripts: { test: 'jest' },
        devDependencies: { jest: '^29.6.4', '@babel/core': '^7.25.2', '@babel/preset-env': '^7.25.2', 'babel-jest': '^29.6.4' },
      }, null, 2))
    }
    const install = await runCommand('npm', ['install', '--no-audit', '--no-fund'], { cwd: scoringDir, timeoutMs: 5 * 60_000 })
    if (install.status !== 'completed') return { status: 'scoring-error', detail: install.stderr }
    command = 'npx'
    args = ['jest', 'tests']
  } else if (language === 'rust') {
    cpSync(testsSource, join(scoringDir, 'tests'), { recursive: true })
    command = 'cargo'
    args = ['test']
  } else if (language === 'cpp') {
    cpSync(testsSource, join(scoringDir, 'tests'), { recursive: true })
    command = 'bash'
    args = ['-c', `
      set -e
      cd '${scoringDir}'
      g++ -std=c++17 -o /tmp/dsh-bench-cpp-score tests/*_test.cpp tests/test/tests-main.cpp -I. -Itests 2>/dev/null || \
      g++ -std=c++17 -o /tmp/dsh-bench-cpp-score $(find . -name '*_test.cpp') tests/test/tests-main.cpp -I. -Itests/test
      /tmp/dsh-bench-cpp-score
    `]
  } else if (language === 'java') {
    // Gradle-wrapper based; needs network on first use.
    const testSources = join(testsSource, 'src', 'test')
    if (!existsSync(testSources)) return { status: 'unsupported', detail: 'no src/test in dataset task' }
    mkdirSync(join(scoringDir, 'src'), { recursive: true })
    cpSync(testSources, join(scoringDir, 'src', 'test'), { recursive: true })
    command = './gradlew'
    args = ['test', '--console=plain']
  } else if (language === 'go') {
    return { status: 'unsupported', detail: 'go toolchain not installed on this host' }
  } else {
    return { status: 'unsupported', detail: `no native scorer for ${language}` }
  }

  const outcome = await runCommand(command, args, { cwd: scoringDir, timeoutMs, env: { PYTHONPATH: scoringDir } })
  writeFileSync(`${scoringDir}-test-output.log`, outcome.stdout)
  return {
    status: outcome.status === 'completed' ? 'passed' : 'failed',
    exitCode: outcome.exitCode,
    scoredIn: scoringDir,
  }
}

const filter = process.argv[2]
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'))
const taskById = new Map(manifest.tasks.map(task => [`${task.dataset}/${task.id}`, task]))

for (const entry of readdirSync(RESULTS_DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue
  if (filter !== undefined && !entry.name.includes(filter)) continue
  const resultPath = join(RESULTS_DIR, entry.name, 'result.json')
  if (!existsSync(resultPath)) continue
  const result = JSON.parse(readFileSync(resultPath, 'utf8'))
  if (result.score !== undefined) {
    console.log(`skip ${entry.name} (already scored: ${result.score.status})`)
    continue
  }
  const task = taskById.get(result.taskKey)
  if (task === undefined) throw new Error(`run references unknown task: ${result.taskKey}`)

  let score
  if (task.executionMode === 'docker') {
    score = { status: 'requires-docker' }
  } else {
    const workspace = join(RESULTS_DIR, entry.name, 'workspace')
    if (!existsSync(workspace)) {
      score = { status: 'no-workspace' }
    } else {
      console.log(`scoring ${entry.name} (${task.language})`)
      score = await scoreNative(join(DATASETS_DIR, task.dataset, task.id), workspace, task.language)
    }
  }

  result.score = score
  writeFileSync(resultPath, JSON.stringify(result, null, 2))
  console.log(`  → ${score.status}`)
}
