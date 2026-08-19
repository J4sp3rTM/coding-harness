/**
 * Command UI plugin, browser half: CommandUiRuntime (`ctx.commandUi`) owning the
 * capability-keyed directory cache, the '/' command source, the client
 * contribution registry, and the per-session popupSelect controllers. The
 * popupSelect shell self-registers into conversation.input.overlay with
 * per-session resolution; text-bearing command outcomes render in the
 * frame-wide shell overlay even while the session is blank.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the 'conversation.input.overlay' SlotMap declaration (the
// key's owner) into this program so the overlay registration below typechecks
// against the real declaration — no runtime edge to ui-conversation.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the frame-owned 'shell.overlay' SlotMap declaration.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { CommandOutcomeController, CommandOutcomeToast } from './CommandOutcomeToast.tsx'
import type { CommandOutcomeToastInjected } from './CommandOutcomeToast.tsx'
import { CommandUiRuntime } from './service.ts'
import type { PopupSelectInjected } from './PopupSelectView.tsx'
import { PopupSelectView } from './PopupSelectView.tsx'
import { en, zh, type CommandKey } from './locales.ts'

export { CommandUiRuntime } from './service.ts'
export { CommandDirectory } from './directory.ts'
export type { CommandDescriptor, DirectoryStatus } from './directory.ts'
export { filterOptions, PopupSelectController } from './popup.ts'
export type { PopupSelectDeps, PopupSpec, PopupState, TokenSegment } from './popup.ts'
export type { PopupSelectInjected, PopupSelectViewProps } from './PopupSelectView.tsx'
export type {
  CommandContribution, CommandDecoration, CommandUiContract, CommandUiSpec, SelectConfirmation, SelectOption,
} from './contract.ts'
export type { CommandKey } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    commandUi: CommandUiRuntime
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The popupSelect shell's copy. */
    command: CommandKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'command'

/**
 * Commands whose outcome is announced by the frame-wide toast. Sign-in and
 * sign-out settle away from the transcript — often with no chat history at
 * all — so their result needs a surface that does not depend on a command row.
 */
const TOASTED_COMMANDS = new Set(['login', 'logout'])

/** Required services: the '/' source registry, session scopes, commands Remote, and locale registry. */
export const inject = ['inputTriggers', 'sessions', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: mount the service, then register the popupSelect shell
 * into the input overlay once its declarer is up.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-commands: dictionaries')
  ctx.plugin(CommandUiRuntime)
  const outcomes = new CommandOutcomeController()
  ctx.effect(() => () => { outcomes.dispose() }, 'ui-commands: command outcome state')
  ctx.on('command/executed', (sessionId, command, result) => {
    if (!TOASTED_COMMANDS.has(command)) return
    // The durable command row is the replay surface wherever Chat renders
    // one, so a session with history needs no second announcement. Only the
    // blank session — which intentionally shows no rows — falls back to the
    // toast. An unknown session is treated as blank: absence of a summary is
    // never evidence that history exists.
    if (ctx.sessions.list.getSnapshot().byId[sessionId]?.blank === false) return
    outcomes.show(result)
  })
  ctx.inject(['slots', 'commandUi', 'sessions'], (scope: ClientContext) => {
    const command = scope.commandUi
    const sessions = scope.sessions
    scope.slots.inject('shell.overlay', () => scope.slots.register({
      name: 'shell.overlay',
      id: 'command-outcome',
      order: 10,
      inject: (): CommandOutcomeToastInjected => ({ outcomes }),
    }, CommandOutcomeToast))
    scope.slots.inject('conversation.input.overlay', () => scope.slots.register({
      name: 'conversation.input.overlay',
      id: 'command-popup',
      order: 1,
      locale: NS,
      inject: (sessionId): PopupSelectInjected => {
        const actx = sessions.scope(sessionId)
        if (actx === undefined) throw new Error(`ui-commands: session "${String(sessionId)}" resolved no scope`)
        return { popup: command.popupFor(actx) }
      },
    }, PopupSelectView))
  })
}
