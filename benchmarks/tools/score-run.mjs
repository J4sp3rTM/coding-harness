/**
 * Scores recorded benchmark runs against each dataset's own tests.
 *
 * Native datasets (aider-polyglot): the task's tests/ directory is copied into a
 * scoring copy of the run workspace (tests were never visible to the agent) and the
 * language's standard test runner decides pass/fail by exit code.
 *
 * Docker-mode tasks (terminal-bench-core, swebench-verified): tests are copied into
 * the still-running task container and its packaged run-tests.sh decides; swebench
 * additionally prints a PASSED/FAILED marker that takes precedence over exit code.
 * The container is removed after scoring either way.
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
      # Compile the agent's implementation files together with the test files and
      # the catch harness; without the implementation objects linking always fails.
      g++ -std=c++17 -o /tmp/dsh-bench-cpp-score \\
        $(find . -maxdepth 2 -name '*.cpp' ! -path './tests/test/*') \\
        tests/test/tests-main.cpp -I. -Itests -Itests/test
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
    // Exercism layout: single module root package; copy only the .go test files next
    // to the implementation. Copying the tests/ tree would make `go test ./...`
    // compile it as a separate package and fail spuriously.
    const goTestFiles = readdirSync(testsSource).filter(f => f.endsWith('.go'))
    if (goTestFiles.length === 0) return { status: 'unsupported', detail: 'no go tests found' }
    for (const f of goTestFiles) cpSync(join(testsSource, f), join(scoringDir, f))
    command = 'go'
    args = ['test', './...']
  } else {
    return { status: 'unsupported', detail: `no native scorer for ${language}` }
  }

  const outcome = await runCommand(command, args, { cwd: scoringDir, timeoutMs, env: { PYTHONPATH: scoringDir } })
  writeFileSync(`${scoringDir}-test-output.log`, `${outcome.stdout}\n${outcome.stderr}`)
  return {
    status: outcome.status === 'completed' ? 'passed' : 'failed',
    exitCode: outcome.exitCode,
    scoredIn: scoringDir,
  }
}

/**
 * Ensures the task container is up, rebuilding from cached layers when a previous
 * scoring pass removed it. Needed to re-score runs whose containers were torn down.
 */
async function ensureContainer(taskDir, containerName) {
  const inspect = await runCommand('docker', ['container', 'inspect', containerName], { timeoutMs: 30_000 })
  if (inspect.status === 'completed') return null
  const up = await runCommand('docker', ['compose', '-p', containerName, '-f', join(taskDir, 'docker-compose.yaml'), 'up', '-d'], {
    timeoutMs: 30 * 60_000,
    env: {
      T_BENCH_TASK_DOCKER_CLIENT_IMAGE_NAME: `dsh-bench-${containerName}`,
      T_BENCH_TASK_DOCKER_CLIENT_CONTAINER_NAME: containerName,
      T_BENCH_TASK_LOGS_PATH: '/tmp/dsh-bench-misc/logs',
      T_BENCH_CONTAINER_LOGS_PATH: '/logs',
      T_BENCH_TASK_AGENT_LOGS_PATH: '/tmp/dsh-bench-misc/agent-logs',
      T_BENCH_CONTAINER_AGENT_LOGS_PATH: '/agent-logs',
    },
  })
  if (up.status !== 'completed') return up.stderr
  return null
}

/** Runs the task's own run-tests.sh inside the still-running container, then removes it. */
async function scoreDocker(taskDir, runDir, containerName) {
  const ensureError = await ensureContainer(taskDir, containerName)
  if (ensureError !== null) return { status: 'no-container', detail: ensureError.slice(-500) }
  // Terminal-bench's contract puts tests at /tests; swebench's packaged run-tests.sh
  // reads /tests/config.json directly, so TEST_DIR and the copy target must agree.
  await runCommand('docker', ['exec', containerName, 'rm', '-rf', '/tests'], { timeoutMs: 30_000 })
  const cpTests = await runCommand('docker', ['cp', `${join(taskDir, 'tests')}/.`, `${containerName}:/tests`], { timeoutMs: 120_000 })
  if (cpTests.status !== 'completed') return { status: 'scoring-error', detail: cpTests.stderr }
  if (existsSync(join(taskDir, 'run-tests.sh'))) {
    const cpScript = await runCommand('docker', ['cp', join(taskDir, 'run-tests.sh'), `${containerName}:/tmp/run-tests.sh`], { timeoutMs: 60_000 })
    if (cpScript.status !== 'completed') return { status: 'scoring-error', detail: cpScript.stderr }
  } else {
    return { status: 'unsupported', detail: 'docker task without run-tests.sh' }
  }
  const outcome = await runCommand(
    'docker',
    ['exec', containerName, 'bash', '-lc', 'export TEST_DIR=/tests; bash /tmp/run-tests.sh'],
    { timeoutMs: 40 * 60_000 },
  )
  // SWE-bench packaged tasks report their verdict between marker lines; trust it over exit codes.
  let status = outcome.status === 'completed' ? 'passed' : 'failed'
  if (/SWEBench results starts here\s*\nPASSED/.test(outcome.stdout)) status = 'passed'
  if (/SWEBench results starts here\s*\nFAILED/.test(outcome.stdout)) status = 'failed'
  writeFileSync(join(runDir, 'test-output.log'), outcome.stdout.slice(-20_000))
  // Tear down everything labelled with this run's compose project: helper services,
  // networks, and volumes. Label filters avoid re-running compose with task-specific
  // environment variables that the down path would otherwise need. containerName is
  // restricted to [a-z0-9_-] at creation, so shell interpolation here is safe.
  const removeByLabel = `docker rm -f $(docker ps -aq --filter 'label=com.docker.compose.project=${containerName}') 2>/dev/null; true`
  await runCommand('bash', ['-c', removeByLabel], { timeoutMs: 120_000 })
  const removeVolumes = `docker volume rm $(docker volume ls -q --filter 'label=com.docker.compose.project=${containerName}') 2>/dev/null; true`
  await runCommand('bash', ['-c', removeVolumes], { timeoutMs: 60_000 })
  // Networks count against Docker's finite default address pools; leaving them
  // behind eventually makes every new compose network fail pool allocation.
  const removeNetworks = `docker network rm $(docker network ls -q --filter 'label=com.docker.compose.project=${containerName}') 2>/dev/null; true`
  await runCommand('bash', ['-c', removeNetworks], { timeoutMs: 60_000 })
  // Free the per-run image immediately: 30 swebench eval images would exhaust the VM disk.
  await runCommand('docker', ['rmi', '-f', `dsh-bench-${containerName}`], { timeoutMs: 120_000 })
  return { status, exitCode: outcome.exitCode, detail: outcome.stderr.slice(-2_000) }
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
  if (result.status === 'container-error') {
    console.log(`skip ${entry.name} (run never produced an environment; delete its dir to re-run)`)
    continue
  }
  if (result.score !== undefined) {
    console.log(`skip ${entry.name} (already scored: ${result.score.status})`)
    continue
  }
  const task = taskById.get(result.taskKey)
  if (task === undefined) throw new Error(`run references unknown task: ${result.taskKey}`)

  let score
  if (task.executionMode === 'docker') {
    const containerName = result.containerName
    if (containerName === undefined || containerName === null) {
      score = { status: 'no-container' }
    } else {
      console.log(`scoring ${entry.name} in container ${containerName}`)
      score = await scoreDocker(join(DATASETS_DIR, task.dataset, task.id), join(RESULTS_DIR, entry.name), containerName)
    }
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
