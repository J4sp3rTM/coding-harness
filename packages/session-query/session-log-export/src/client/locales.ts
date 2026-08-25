/** `session-log-download` namespace dictionary. */
export const NS = 'session-log-download'

/** English Session export strings. */
export const en = {
  'dialog.preparingTitle': 'Exporting Session',
  'dialog.preparingDescription': 'Preparing a ZIP containing this Session, its sub-Sessions, and attachments.',
  'dialog.successTitle': 'Session download started',
  'dialog.successDescription': 'The browser is downloading the Session ZIP.',
  'dialog.errorTitle': 'Session export failed',
  'dialog.close': 'Close',
  'dialog.commandFailed': 'Could not start the Session export.',
} satisfies Record<string, string>

/** The session-log-download namespace key union. */
export type SessionLogDownloadKey = keyof typeof en
