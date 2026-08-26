/**
 * Browser-safe durable workflow-record events written by the model-facing
 * workflow tool into its calling parent Session.
 *
 * @module @deepseek-ai/dsh-tool-workflow/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  WorkflowAgentOutcome, WorkflowRunId, WorkflowStopReason,
} from '@deepseek-ai/dsh-workflow/types'

/** Opens one durable top-level workflow run record. */
export interface ToolWorkflowRunStartData {
  readonly runId: WorkflowRunId
  readonly name: string
}

/** Records one workflow member after its child Session is published. */
export interface ToolWorkflowAgentStartData {
  readonly runId: WorkflowRunId
  readonly seq: number
  readonly label: string
  readonly phase?: string
  readonly childId: SessionId
  /** Provider override passed to this child; omitted when the call inherited the parent provider. */
  readonly provider?: string
  /** Model override passed to this child; omitted when the call inherited the parent model. */
  readonly model?: string
  /** Configured reasoning effort passed to this child; omitted when the call used the provider default. */
  readonly effort?: string
  /**
   * Whether `effort` was supplied on the `agent()` call (`configured`) or omitted so
   * the selected model's provider default applies (`provider-default`).
   */
  readonly effortSource?: 'configured' | 'provider-default'
}

/** Settles one previously started workflow member. */
export interface ToolWorkflowAgentEndData {
  readonly runId: WorkflowRunId
  readonly seq: number
  readonly outcome: WorkflowAgentOutcome
}

/**
 * Records that one user message was accepted by a workflow while it held the
 * parent's turn. The message itself stays in `user/message`; this receipt says
 * only that the run accepted the input, not that any worker acted on it.
 */
export interface ToolWorkflowSteeringData {
  readonly runId: WorkflowRunId
}

/** Settles one workflow run after its live resources reach quiescence. */
export interface ToolWorkflowRunEndData {
  readonly runId: WorkflowRunId
  readonly stopReason: WorkflowStopReason
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Opens one top-level workflow record.
     * @param data - stable run identity and display name.
     */
    'tool-workflow/run-start': ToolWorkflowRunStartData
    /**
     * Records one published workflow member.
     * @param data - run identity, member sequence, display identity, child Session, and optional provider/model/effort route.
     */
    'tool-workflow/agent-start': ToolWorkflowAgentStartData
    /**
     * Records one member settlement.
     * @param data - run identity, paired member sequence, and outcome.
     */
    'tool-workflow/agent-end': ToolWorkflowAgentEndData
    /**
     * Records one user message accepted by this run mid-flight; it does not
     * assert that a worker acted on the message.
     * @param data - the receiving run's identity.
     */
    'tool-workflow/steering': ToolWorkflowSteeringData
    /**
     * Closes one workflow record after cleanup.
     * @param data - stable run identity and terminal reason.
     */
    'tool-workflow/run-end': ToolWorkflowRunEndData
  }
}
