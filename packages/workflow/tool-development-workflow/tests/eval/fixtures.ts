/**
 * Deterministic A/B fixture catalog. Each fixture is a tiny Node project with
 * a seed (failing tests), an oracle (passing sources), and routing signals a
 * parent would attach if it called delegate_work.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { WorkUnitSignals } from '../../src/route.ts'

/** One of the four required benchmark categories. */
export type FixtureCategory =
  | 'tiny-localized'
  | 'repetitive-mechanical'
  | 'medium-implementation'
  | 'risky-cross-component'

/** Work units a parent would submit if it chose to delegate this fixture. */
export interface FixtureUnits {
  /** Units used to compute shipped and legacy routing. */
  units: WorkUnitSignals[]
}

/** On-disk fixture plus the validation command and routing signals. */
export interface FixtureSpec extends FixtureUnits {
  id: FixtureCategory
  /** Human-readable task the parent would receive. */
  task: string
  /** Directory containing seed/ and oracle/. */
  root: string
  /** Validation command run after each variant; must terminate. */
  validation: { command: string; args: string[] }
}

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/**
 * The four fixture categories. Validation is always `node test.js` in the
 * copied workspace so the grader never shells out through PowerShell.
 */
export const FIXTURES: readonly FixtureSpec[] = [
  {
    id: 'tiny-localized',
    task: 'Fix greet() so it returns Hello, <name>!. Edit only src/greet.js.',
    root: join(fixturesRoot, 'tiny-localized'),
    validation: { command: process.execPath, args: ['test.js'] },
    units: [{
      role: 'implementation',
      complexity: 'simple',
      risk: 'low',
      scopes: ['src/greet.js'],
    }],
  },
  {
    id: 'repetitive-mechanical',
    task: 'Add return to add, sub, mul, div, and mod. Same mechanical edit five times.',
    root: join(fixturesRoot, 'repetitive-mechanical'),
    validation: { command: process.execPath, args: ['test.js'] },
    units: [{
      role: 'implementation',
      complexity: 'simple',
      risk: 'low',
      repetitive: true,
      scopes: ['src/ops.js'],
    }],
  },
  {
    id: 'medium-implementation',
    task: 'Implement the checked key-value store across store, validate, and index.',
    root: join(fixturesRoot, 'medium-implementation'),
    validation: { command: process.execPath, args: ['test.js'] },
    units: [{
      role: 'implementation',
      complexity: 'ordinary',
      risk: 'medium',
      scopes: ['src/store.js', 'src/validate.js', 'src/index.js'],
    }],
  },
  {
    id: 'risky-cross-component',
    task: 'Rename user.name to user.displayName across the shared contract and its readers/writers.',
    root: join(fixturesRoot, 'risky-cross-component'),
    validation: { command: process.execPath, args: ['test.js'] },
    units: [
      {
        role: 'implementation',
        complexity: 'ordinary',
        risk: 'high',
        scopes: ['src/contract.js', 'src/read.js', 'src/write.js', 'src/format.js'],
      },
      {
        role: 'review',
        complexity: 'complex',
        risk: 'high',
        exceptional: true,
        scopes: ['src'],
      },
    ],
  },
]
