/**
 * Fixed, model-facing planned development workflow. The parent supplies a
 * plan and minimum work units; this consumer owns routing and orchestration,
 * while execution remains on `ctx.workflowEngine`.
 * @module @deepseek-ai/dsh-tool-development-workflow
 */
import type { Context } from '@deepseek-ai/cordis'
import { resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { WorkflowResult, WorkflowRun } from '@deepseek-ai/dsh-workflow'
import { createWorkflowRecorder } from '@deepseek-ai/dsh-tool-workflow/recorder'
import { DEVELOPMENT_WORKFLOW_SETTINGS_NAMESPACE, type DevelopmentWorkflowSettings } from './settings.ts'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'tool-development-workflow'
export const inject = ['tools', 'workflowEngine', 'systemPrompt']
// Rosterless tests and detached sessions have no persisted cwd.
const fallbackWorkspaceCwd = process.cwd()

/** A provider/model route. Omitted fields inherit the parent agent route. */
export interface TierRoute {
  /** Optional provider override; omission inherits the parent provider. */
  provider?: string
  /** Optional model override; omission inherits the parent model. */
  model?: string
  /** Optional adapter-owned reasoning effort; omission uses the selected model's default. */
  reasoningEffort?: string
}

/** Deployment policy for the fixed development workflow. */
export interface Config {
  /** Maximum work units accepted in one call and deployment ceiling. */
  maxWorkUnits?: number
  /** Maximum serialized child handoff size. */
  maxHandoffChars?: number
  /** Maximum parent-facing result text. */
  maxResultChars?: number
}

export const Config: z<Config> = z.object({
  maxWorkUnits: z.natural().min(1).default(8),
  maxHandoffChars: z.natural().min(1).default(16_384),
  maxResultChars: z.natural().min(1).default(16_384),
})

type Role = 'implementation' | 'inspection' | 'validation' | 'review'
type Complexity = 'simple' | 'ordinary' | 'complex'
type Risk = 'low' | 'medium' | 'high'
type Tier = 'T1' | 'T2' | 'T3'

interface WorkUnit {
  id: string
  role: Role
  task: string
  complexity?: Complexity
  risk?: Risk
  exceptional?: boolean
  scopes?: string[]
}

interface ResolvedUnit extends WorkUnit { tier: Tier; route: TierRoute }
interface CallArgs { objective: string; plan: string; workUnits: WorkUnit[]; parallel?: boolean }

/**
 * Resolve the minimum tier from role, complexity and risk.
 * @param unit - the model-selected work-unit signals.
 * @returns the deployment tier selected for the unit.
 */
export function routeTier(unit: Pick<WorkUnit, 'role' | 'complexity' | 'risk' | 'exceptional'>): Tier {
  if (unit.role === 'review' && unit.exceptional === true) return 'T1'
  if ((unit.complexity ?? 'ordinary') === 'simple' && (unit.risk ?? 'medium') === 'low') return 'T3'
  return 'T2'
}

function normalized(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) throw new Error(`${label} must be a non-empty normalized string`)
  return value
}

function normalizedScope(value: string, workspaceCwd: string): string {
  const absolute = resolve(workspaceCwd, value.trim().replaceAll('\\', '/')).replaceAll('\\', '/')
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

function scopesOverlap(left: string, right: string, workspaceCwd: string): boolean {
  const a = normalizedScope(left, workspaceCwd)
  const b = normalizedScope(right, workspaceCwd)
  const descendant = (child: string, parent: string): boolean => child.startsWith(parent.endsWith('/') ? parent : `${parent}/`)
  return a === b || descendant(a, b) || descendant(b, a)
}

function resolveConfig(config: Config): Required<Pick<Config, 'maxWorkUnits' | 'maxHandoffChars' | 'maxResultChars'>> {
  const maxWorkUnits = config.maxWorkUnits ?? 8
  const maxHandoffChars = config.maxHandoffChars ?? 16_384
  const maxResultChars = config.maxResultChars ?? 16_384
  if (![maxWorkUnits, maxHandoffChars, maxResultChars].every(value => Number.isSafeInteger(value) && value > 0)) throw new TypeError('development workflow limits must be positive safe integers')
  return { maxWorkUnits, maxHandoffChars, maxResultChars }
}

function resolvedTierRoutes(ctx: Context): { t1: TierRoute; t2: TierRoute; t3: TierRoute } {
  const value = ctx.get('settings')?.get(DEVELOPMENT_WORKFLOW_SETTINGS_NAMESPACE) as DevelopmentWorkflowSettings | undefined
  const tiers = value?.tiers
  return { t1: { ...tiers?.t1 }, t2: { ...tiers?.t2 }, t3: { ...tiers?.t3 } }
}

function resolveUnits(
  args: CallArgs,
  config: ReturnType<typeof resolveConfig>,
  workspaceCwd: string,
  tiers: { t1: TierRoute; t2: TierRoute; t3: TierRoute },
): ResolvedUnit[] {
  if (!Array.isArray(args.workUnits) || args.workUnits.length === 0 || args.workUnits.length > config.maxWorkUnits) throw new Error(`development workflow requires 1-${config.maxWorkUnits} work units`)
  const ids = new Set<string>()
  const scopes: string[] = []
  const units = args.workUnits.map((unit, index) => {
    const allowed = new Set(['id', 'role', 'task', 'complexity', 'risk', 'exceptional', 'scopes'])
    for (const key of Object.keys(unit)) if (!allowed.has(key)) throw new Error(`workUnits[${index}] contains unknown field: ${key}`)
    const id = normalized(unit.id, `workUnits[${index}].id`)
    const task = normalized(unit.task, `workUnits[${index}].task`)
    if (ids.has(id)) throw new Error(`work unit id is duplicated: ${id}`)
    ids.add(id)
    const role = unit.role
    if (!['implementation', 'inspection', 'validation', 'review'].includes(role)) throw new Error(`workUnits[${index}].role is invalid`)
    if (unit.complexity !== undefined && !['simple', 'ordinary', 'complex'].includes(unit.complexity)) throw new Error(`workUnits[${index}].complexity is invalid`)
    if (unit.risk !== undefined && !['low', 'medium', 'high'].includes(unit.risk)) throw new Error(`workUnits[${index}].risk is invalid`)
    if (unit.exceptional !== undefined && typeof unit.exceptional !== 'boolean') throw new Error(`workUnits[${index}].exceptional must be boolean`)
    if (unit.scopes !== undefined && (!Array.isArray(unit.scopes) || !unit.scopes.every(scope => typeof scope === 'string'))) throw new Error(`workUnits[${index}].scopes must be strings`)
    const selected = routeTier(unit)
    if (args.parallel === true) {
      if (!Array.isArray(unit.scopes) || unit.scopes.length === 0) throw new Error(`work unit ${id} needs non-overlapping scopes when parallel is true`)
      for (const scope of unit.scopes) {
        const declaredScope = normalized(scope, `${id}.scopes`)
        if (scopes.some(existing => scopesOverlap(existing, declaredScope, workspaceCwd))) throw new Error(`parallel work-unit scopes overlap: ${declaredScope}`)
        scopes.push(declaredScope)
      }
    }
    return {
      id, role, task,
      ...unit.complexity === undefined ? {} : { complexity: unit.complexity },
      ...unit.risk === undefined ? {} : { risk: unit.risk },
      ...unit.exceptional === undefined ? {} : { exceptional: unit.exceptional },
      ...unit.scopes === undefined ? {} : { scopes: unit.scopes },
      tier: selected,
      route: tiers[selected.toLowerCase() as 't1' | 't2' | 't3'],
    }
  })
  return units
}

const REPORT_SCHEMA = '{ type: \'object\', properties: { summary: { type: \'string\' }, changedFiles: { type: \'array\', items: { type: \'string\' } }, validationEvidence: { type: \'array\', items: { type: \'string\' } }, risks: { type: \'array\', items: { type: \'string\' } }, followUps: { type: \'array\', items: { type: \'string\' } } }, required: [\'summary\', \'changedFiles\', \'validationEvidence\', \'risks\', \'followUps\'], additionalProperties: false }'

const SCRIPT = String.raw`
const reportSchema = ${REPORT_SCHEMA}
function workerPrompt(objective, plan, unit) {
  const permission = unit.role === 'implementation' ? 'You may edit files only within the declared scopes.' : 'You are read-only: do not edit, create, delete, or format files.'
  const roleGuidance = unit.role === 'review' ? 'Identify concrete defects with file and line evidence; do not make fixes.' : unit.role === 'validation' ? 'Run only relevant checks for this unit and report exact commands and results in validationEvidence.' : ''
  return ['You are a delegated development worker. Work only on the assigned unit in the shared workspace.', 'The parent has already planned the work and will inspect the diff and run authoritative validation.', permission, roleGuidance, 'Declared scopes: ' + JSON.stringify(unit.scopes || []), 'Objective: ' + objective, 'Plan: ' + plan, 'Role: ' + unit.role, 'Unit: ' + unit.id, 'Task: ' + unit.task, 'Do not broaden scope or claim validation you did not run. Return a structured report with a concise summary, changedFiles, validationEvidence, risks, and followUps.'].join('\\n\\n')
}
async function runOne(unit) {
  const options = { label: unit.id, schema: reportSchema, ...unit.route.provider === undefined ? {} : { provider: unit.route.provider }, ...unit.route.model === undefined ? {} : { model: unit.route.model }, ...unit.route.reasoningEffort === undefined ? {} : { effort: unit.route.reasoningEffort } }
  const report = await agent(workerPrompt(args.objective, args.plan, unit), options)
  if (report === null) return { id: unit.id, role: unit.role, tier: unit.tier, status: 'failed', summary: 'Worker failed before returning a report.', changedFiles: [], validationEvidence: [], risks: ['Worker did not return a structured result.'], followUps: ['Parent should inspect the workspace and decide whether to retry.'] }
  return { id: unit.id, role: unit.role, tier: unit.tier, status: 'completed', ...report }
}
phase('Development work')
let reports
if (args.parallel === true) {
  reports = await parallel(args.units.map(unit => () => runOne(unit)))
} else {
  reports = []
  for (const unit of args.units) reports.push(await runOne(unit))
}
return { objective: args.objective, reports }
`

const DESCRIPTION = 'Submit the minimum planned development work units after you have made a plan. Use roles implementation, inspection, validation, or exceptional review. Routes are selected automatically: T3 for simple low-risk repetition, T2 for ordinary work, and T1 only for exceptional review. Configured tier provider/model fields are optional; omitted fields inherit the parent route. A configured reasoning effort applies to that tier\'s selected model; omission uses its provider default. Work runs sequentially unless you explicitly assert independent, non-overlapping scopes with parallel: true. Workers return structured reports; the parent must inspect diffs, run authoritative validation, and decide whether another delegation is needed. Do not use this for trivial work.'

function stopError(result: WorkflowResult): string | undefined {
  switch (result.stopReason) {
    case 'completed': return undefined
    case 'cancelled': return `development workflow was cancelled${result.error === undefined ? '' : ` (${result.error})`}`
    case 'error': return `development workflow failed: ${result.error ?? 'unknown error'}`
    default: return `development workflow ended abnormally (${String(result.stopReason)})`
  }
}

function readResult(value: unknown, maxHandoffChars: number): { objective: string; reports: unknown[] } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('development workflow returned a malformed result')
  const record = value as Record<string, unknown>
  if (typeof record.objective !== 'string' || !Array.isArray(record.reports)) throw new Error('development workflow returned a malformed result')
  if (JSON.stringify(value).length > maxHandoffChars) throw new Error(`development workflow result exceeds maxHandoffChars (${maxHandoffChars})`)
  return { objective: record.objective, reports: record.reports }
}

function render(value: { objective: string; reports: unknown[] }, maxChars: number): string {
  const text = `Development workflow completed for: ${value.objective}\\nReports:\\n${JSON.stringify(value.reports, null, 2)}`
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 16))}\\n… [truncated]`
}

function presentCall(args: CallArgs): ToolCallView { return { card: 'generic', title: 'development workflow', rawInput: args.plan } }
function presentResult(_args: CallArgs, _result: { content: ContentBlock[]; isError: boolean }): ToolResultView { return { card: 'generic' } }

/** Register the fixed development workflow tool. */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const recorder = createWorkflowRecorder(ctx)
  ctx.systemPrompt.section({ name: 'tool:delegate_work', order: 116.25, text: 'Use the delegate_work tool only after planning a non-trivial coding task. Choose the minimum work units. Prefer T3 for low-risk repetition, T2 for implementation/inspection/validation, and T1 rarely for exceptional review. The parent always reviews diffs, runs authoritative validation, and owns the final decision.' })
  ctx.tools.register(defineTool({
    name: 'delegate_work',
    description: DESCRIPTION,
    parameters: {
      objective: { type: 'string', required: true, description: 'The bounded development objective.' },
      plan: { type: 'string', required: true, description: 'The parent plan that workers must follow.' },
      parallel: { type: 'boolean', description: 'Assert that all units have independent, non-overlapping scopes. Defaults to sequential execution.' },
      workUnits: { type: 'array', required: true, description: 'Minimum planned work units.', items: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string', required: true }, task: { type: 'string', required: true }, role: { type: 'string', required: true, enum: ['implementation', 'inspection', 'validation', 'review'] }, complexity: { type: 'string', enum: ['simple', 'ordinary', 'complex'] }, risk: { type: 'string', enum: ['low', 'medium', 'high'] }, exceptional: { type: 'boolean' }, scopes: { type: 'array', items: { type: 'string' } },
      } } },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { runId: { type: 'string', required: true }, agentsStarted: { type: 'integer', required: true }, result: { type: 'json', required: true } } }, render: (_args, value) => [{ type: 'text', text: render(value.result as unknown as { objective: string; reports: unknown[] }, resolved.maxResultChars) }] },
    async execute(args: CallArgs, exec) {
      const parent = exec.agent
      if (parent === undefined) throw new Error('development workflow requires a calling agent (exec.agent was undefined)')
      const objective = normalized(args.objective, 'objective')
      const plan = normalized(args.plan, 'plan')
      const workspaceCwd = parent.session.header.cwd ?? fallbackWorkspaceCwd
      // Resolve settings exactly once: later writes affect the next call, not
      // an already-started workflow.
      const tiers = resolvedTierRoutes(ctx)
      const units = resolveUnits(args, resolved, workspaceCwd, tiers)
      const run: WorkflowRun = ctx.workflowEngine.start({ script: SCRIPT, meta: { name: 'development-workflow', description: 'Execute minimum planned development work units.' }, args: { objective, plan, units, parallel: args.parallel === true }, maxTotalAgents: units.length, parent, signal: exec.signal })
      const recordsRun = exec.parent === undefined
      if (recordsRun) recorder.start(parent.session, run)
      const onAbort = (): void => { run.cancel('parent step aborted') }
      exec.signal.addEventListener('abort', onAbort, { once: true })
      let settled: WorkflowResult | undefined
      try {
        settled = await run.result
        const error = stopError(settled)
        if (error !== undefined) throw new Error(error)
        return {
          runId: run.id,
          agentsStarted: settled.agentsStarted,
          result: readResult(settled.value, resolved.maxHandoffChars) as unknown as JsonValue,
        }
      } finally {
        exec.signal.removeEventListener('abort', onAbort)
        try {
          await run.dispose()
          if (recordsRun) {
            if (settled === undefined) throw new Error('development workflow run settled without a result')
            recorder.finish(run.id, settled.stopReason)
          }
        } finally {
          if (recordsRun) recorder.abandon(run.id)
        }
      }
    },
    presentCall,
    presentResult,
  }))
}
