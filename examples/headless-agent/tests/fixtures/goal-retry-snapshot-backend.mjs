/** Deterministic provider adapter for the headless goal-retry snapshot. */

import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'

class GoalRetrySnapshotAdapter extends LlmAdapter {
  requests = 0
  goalMessages

  async * stream(options) {
    this.requests += 1
    const messages = JSON.stringify(options.messages)
    if (this.requests === 1) {
      this.goalMessages = messages
    }
    if (messages !== this.goalMessages) throw new Error('goal retry changed the model-visible messages')
    if (this.requests <= 2) {
      throw new LlmError('snapshot pi transport failure', 'PI_AI_ERROR')
    }
    yield* textResponse('GOAL_RETRY_OK')
  }
}

function* textResponse(text) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** Cordis plugin name. */
export const name = 'goal-retry-snapshot-backend'
/** Required LLM registry service. */
export const inject = ['llm']

/**
 * Register the deterministic provider adapter.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context carrying the LLM service.
 */
export function apply(ctx) {
  ctx.llm.registerAdapter(['deepseek-official'], new GoalRetrySnapshotAdapter())
}
