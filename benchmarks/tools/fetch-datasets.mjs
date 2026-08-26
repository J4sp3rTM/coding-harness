/**
 * Samples the three real benchmark datasets into benchmarks/datasets/ and freezes
 * benchmarks/manifest.json.
 *
 * Sources (sparse shallow clones; fetched automatically when missing):
 *   - laude-institute/terminal-bench-datasets → datasets/aider_polyglot, datasets/swebench-verified
 *   - laude-institute/terminal-bench          → original-tasks (terminal-bench-core "head")
 *
 * Usage:
 *   node benchmarks/tools/fetch-datasets.mjs            # fetch missing sources + sample + manifest
 *   node benchmarks/tools/fetch-datasets.mjs --no-fetch # sample from existing clones only
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  BENCHMARK_ROOT,
  DATASETS_DIR,
  SAMPLE_SEED,
  describeTask,
  dirSizeBytes,
  hashDir,
  makeRng,
  runSync,
  seededShuffle,
} from './lib.mjs'

const FETCH_DIR = process.env.BENCH_SRC_DIR ?? '/tmp/bench-src'
const POLYGLOT_PER_LANGUAGE = 10
const CORE_TASKS = 40
const SWEBENCH_TASKS = 30
/** Terminal-bench-core tasks above this size are excluded before sampling to keep the tree committable. */
const MAX_CORE_TASK_BYTES = 8 * 1024 * 1024

function fetchSource(name, repoUrl, sparsePath) {
  const target = join(FETCH_DIR, name)
  if (existsSync(join(target, '.git'))) return target
  console.log(`cloning ${repoUrl} (sparse: ${sparsePath}) …`)
  rmSync(target, { recursive: true, force: true })
  runSync('git', ['clone', '-q', '--depth', '1', '--filter=blob:none', '--sparse', repoUrl, target])
  runSync('git', ['-C', target, 'sparse-checkout', 'set', sparsePath])
  return target
}

function listTaskDirs(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(dir, entry.name, 'task.yaml')))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

function sampleAndCopy({ sourceRoot, sourceRel, targetDataset, pickedIds, executionMode, languageOf }) {
  const manifestTasks = []
  for (const taskId of pickedIds) {
    const sourcePath = join(sourceRoot, sourceRel, taskId)
    const targetPath = join(DATASETS_DIR, targetDataset, taskId)
    rmSync(targetPath, { recursive: true, force: true })
    mkdirSync(join(DATASETS_DIR, targetDataset), { recursive: true })
    cpSync(sourcePath, targetPath, { recursive: true })
    const described = describeTask(sourcePath, taskId)
    manifestTasks.push({
      dataset: targetDataset,
      ...described,
      language: languageOf?.(taskId) ?? null,
      executionMode,
      sourcePath: `${sourceRel}/${taskId}`,
      contentSha256: hashDir(targetPath),
    })
  }
  return manifestTasks
}

const noFetch = process.argv.includes('--no-fetch')

// --- sources ----------------------------------------------------------------
const tbDatasetsRepo = noFetch && existsSync(join(FETCH_DIR, 'terminal-bench-datasets'))
  ? join(FETCH_DIR, 'terminal-bench-datasets')
  : fetchSource('terminal-bench-datasets', 'https://github.com/laude-institute/terminal-bench-datasets', 'datasets')
const tbCoreRepo = noFetch && existsSync(join(FETCH_DIR, 'tb-repo'))
  ? join(FETCH_DIR, 'tb-repo')
  : fetchSource('tb-repo', 'https://github.com/laude-institute/terminal-bench', 'original-tasks')

const polyglotSource = join(tbDatasetsRepo, 'datasets', 'aider_polyglot')
const swebenchSource = join(tbDatasetsRepo, 'datasets', 'swebench-verified')
const coreSource = join(tbCoreRepo, 'original-tasks')
for (const dir of [polyglotSource, swebenchSource, coreSource]) {
  if (!existsSync(dir)) throw new Error(`missing dataset source directory: ${dir}`)
}

const commitOf = repo => runSync('git', ['-C', repo, 'rev-parse', 'HEAD'])

// --- aider polyglot: 10 per language -----------------------------------------
const polyglotAll = listTaskDirs(polyglotSource)
const languages = ['cpp', 'go', 'java', 'javascript', 'python', 'rust']
const rngPolyglot = makeRng(SAMPLE_SEED)
const polyglotPicked = []
for (const language of languages) {
  const pool = polyglotAll.filter(id => id.startsWith(`polyglot_${language}_`))
  if (pool.length < POLYGLOT_PER_LANGUAGE) throw new Error(`only ${pool.length} ${language} exercises`)
  polyglotPicked.push(...seededShuffle(pool, rngPolyglot).slice(0, POLYGLOT_PER_LANGUAGE))
}

// --- terminal-bench core: seeded sample of small-enough tasks ------------------
const corePool = listTaskDirs(coreSource).filter(id => dirSizeBytes(join(coreSource, id)) <= MAX_CORE_TASK_BYTES)
const corePicked = seededShuffle(corePool, makeRng(SAMPLE_SEED + 1)).slice(0, CORE_TASKS)

// --- swebench verified: seeded sample ------------------------------------------
const swebenchPicked = seededShuffle(listTaskDirs(swebenchSource), makeRng(SAMPLE_SEED + 2)).slice(0, SWEBENCH_TASKS)

console.log(`sampling: polyglot ${polyglotPicked.length}, core ${corePicked.length}, swebench-verified ${swebenchPicked.length}`)

const tasks = [
  ...sampleAndCopy({
    sourceRoot: polyglotSource, sourceRel: '.', targetDataset: 'aider-polyglot',
    pickedIds: polyglotPicked, executionMode: 'native',
    languageOf: id => id.match(/^polyglot_([a-z]+)_/)?.[1] ?? null,
  }),
  ...sampleAndCopy({
    sourceRoot: coreSource, sourceRel: '.', targetDataset: 'terminal-bench-core',
    pickedIds: corePicked, executionMode: 'docker',
  }),
  ...sampleAndCopy({
    sourceRoot: swebenchSource, sourceRel: '.', targetDataset: 'swebench-verified',
    pickedIds: swebenchPicked, executionMode: 'docker',
  }),
]

tasks.sort((a, b) => `${a.dataset}/${a.id}`.localeCompare(`${b.dataset}/${b.id}`))

const manifest = {
  seed: SAMPLE_SEED,
  benchmark: 'dsh-vs-claude-code-real-datasets',
  datasets: {
    'aider-polyglot': { upstream: 'laude-institute/terminal-bench-datasets@datasets/aider_polyglot', commit: commitOf(tbDatasetsRepo), difficulty: 'medium' },
    'terminal-bench-core': { upstream: 'laude-institute/terminal-bench@original-tasks', commit: commitOf(tbCoreRepo), difficulty: 'hard' },
    'swebench-verified': { upstream: 'laude-institute/terminal-bench-datasets@datasets/swebench-verified', commit: commitOf(tbDatasetsRepo), difficulty: 'hard' },
  },
  taskCount: tasks.length,
  tasks,
}

mkdirSync(BENCHMARK_ROOT, { recursive: true })
writeFileSync(join(BENCHMARK_ROOT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`wrote manifest.json with ${tasks.length} tasks`)
