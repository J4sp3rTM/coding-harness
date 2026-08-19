/**
 * The /api URL prefix — single source for both halves of the web transport.
 * The node half registers this prefix on the web server; both halves share the
 * event paths below for the browser WebSocket downlinks.
 */

/** Route prefix owning every api request (`/api` and `/api/<anything>`). */
export const API_PATH = '/api'

/** Browser mux-frame WebSocket pathname. */
export const MUX_EVENTS_PATH = `${API_PATH}/events.mux`

/** Browser host-frame WebSocket pathname. */
export const HOST_EVENTS_PATH = `${API_PATH}/events.host`

/**
 * URL scheme the desktop shell serves the app from, as `location.protocol`
 * reports it (trailing colon included). Shared so the shell that registers the
 * scheme and the client that recognizes it cannot drift.
 */
export const DESKTOP_SCHEME = 'dsh:'

/** The same scheme without the colon, as Electron's protocol API takes it. */
export const DESKTOP_SCHEME_NAME = 'dsh'
