/** Durable recorder shared by model-facing workflow consumers. */
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { WorkflowRun, WorkflowRunId, WorkflowStopReason } from '@deepseek-ai/dsh-workflow'
import type { ToolWorkflowAgentEndData, ToolWorkflowAgentStartData, ToolWorkflowRunEndData, ToolWorkflowRunStartData } from './types.ts'

interface WorkflowRecorder {
  start(session: Session, run: WorkflowRun): void
  finish(runId: WorkflowRunId, stopReason: WorkflowStopReason): void
  abandon(runId: WorkflowRunId): void
}

interface ToolWorkflowRecordEventMap {
  'tool-workflow/run-start': ToolWorkflowRunStartData
  'tool-workflow/agent-start': ToolWorkflowAgentStartData
  'tool-workflow/agent-end': ToolWorkflowAgentEndData
  'tool-workflow/run-end': ToolWorkflowRunEndData
}

function renderRecordingError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

/**
 * Project active top-level workflow runs into their parent Sessions.
 * @param ctx - context that owns workflow lifecycle events.
 * @returns a recorder whose append failures are contained and disable one run.
 */
export function createWorkflowRecorder(ctx: Context): WorkflowRecorder {
  const active = new Map<WorkflowRunId, Session>()
  const append = <Type extends keyof ToolWorkflowRecordEventMap>(
    session: Session,
    type: Type,
    data: SessionEventMap[Type],
  ): boolean => {
    const appendRecord = session.append.bind(session) as <Event extends keyof ToolWorkflowRecordEventMap>(
      event: Event,
      value: SessionEventMap[Event],
    ) => void
    try {
      appendRecord(type, data)
      return true
    } catch (error: unknown) {
      ctx.logger.warn(`tool-workflow: disabled durable record after ${type} append failed: ${renderRecordingError(error)}`)
      return false
    }
  }
  ctx.on('workflow/agent-start', (info, agent) => {
    const session = active.get(info.id)
    if (session === undefined) return
    const data: ToolWorkflowAgentStartData = {
      runId: info.id,
      seq: agent.seq,
      label: agent.label,
      ...agent.phase === undefined ? {} : { phase: agent.phase },
      childId: agent.childId,
    }
    if (!append(session, 'tool-workflow/agent-start', data)) active.delete(info.id)
  })
  ctx.on('workflow/agent-end', (info, agent) => {
    const session = active.get(info.id)
    if (session === undefined) return
    if (!append(session, 'tool-workflow/agent-end', {
      runId: info.id,
      seq: agent.seq,
      outcome: agent.outcome,
    })) active.delete(info.id)
  })
  return {
    start(session, run) {
      if (append(session, 'tool-workflow/run-start', {
        runId: run.id,
        name: run.meta.name,
      })) active.set(run.id, session)
    },
    finish(runId, stopReason) {
      const session = active.get(runId)
      if (session !== undefined) append(session, 'tool-workflow/run-end', { runId, stopReason })
      active.delete(runId)
    },
    abandon: (runId) => { active.delete(runId) },
  }
}
