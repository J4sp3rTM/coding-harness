/** Durable model-facing marker owned by the `/clear` command. */

/** Plugin source tag on the replacement user message. */
export const CLEAR_PLUGIN_NAME = 'clear'
/** The only user-role text retained on the model surface after clearing. */
export const CLEAR_CHECKPOINT =
  'The earlier conversation in this session was cleared at the user\'s request.'
  + ' No prior messages remain in context; continue as a fresh start.'
