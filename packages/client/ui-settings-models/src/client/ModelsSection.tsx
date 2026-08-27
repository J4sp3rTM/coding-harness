/**
 * Models settings section: the provider rows joined from the configurable
 * directory, settings namespaces, and credential states, with one editor
 * card at a time. Rows expose only confirmed API-key state through accessible
 * solid configured or missing dots. A whole-section provider without a
 * configured key renders as its open setup card instead of a row, but only in
 * the first-run posture — no provider on the page can serve requests yet — and
 * only until the user closes that card; the add flow is a card carrying the
 * dormant-provider select. Each card kind owns its own open state, so closing
 * one never discards a draft in another. Every mutation writes through the
 * wire, while a provider removal first requires confirmation; the page
 * re-renders from pushed invalidations or the post-apply reload.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconPlusOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import { CustomProviderCard } from './CustomProviderCard.tsx'
import { ProviderOrderEditor } from './ProviderOrderEditor.tsx'
import {
  activeConfiguredProviderRows, deriveKeyRef, hasProviderPriority, MODEL_PROVIDER_PRIORITY_SETTINGS_NAMESPACE,
  messageOf, protocolChoices, providerUsable,
} from './store.ts'
import type { ModelsSettingsState, ModelsSettingsStore, ProviderRow } from './store.ts'
import { ProviderEditor, type ProviderEditorProps } from './ProviderEditor.tsx'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Injected dependencies of {@link ModelsSection} (slot `inject`). */
export interface ModelsSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  controller: ModelsSettingsStore
  /** uSES subscription hook bound to the store. */
  useSnapshot: SnapshotSelectorHook<ModelsSettingsState>
  /** Wire faces the editor writes through. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type ModelsSectionProps = Partial<ModelsSectionInjected>

/** Provider identity shared by row actions and confirmation copy. */
export interface ProviderIdentity {
  /** Stable provider route id. */
  provider: string
  /** Human-facing provider name. */
  displayName: string
}

/** One existing row or dormant directory entry addressed by an editor action. */
interface EditorTarget extends ProviderIdentity {
  settingsNs: string
  settingsPath: readonly string[]
  /** Writable credential identified under this page's conventional reference. */
  credentialRef?: string
  /** The adapter reports this route as one it does not ship (see {@link ProviderEditorProps.declared}). */
  declared?: boolean
}

/** Values that vary around the shared provider-editor rendering. */
interface ProviderEditorRenderProps extends Pick<
  ProviderEditorProps,
  'namespace' | 'api' | 't' | 'readOnly' | 'onClose'
> {
  target: EditorTarget
}

type DevelopmentTier = 't1' | 't2' | 't3'
interface DevelopmentTierSelection { provider: string; model: string; reasoningEffort?: string }
type DevelopmentTierDraft = Partial<Record<DevelopmentTier, DevelopmentTierSelection>>

const DEVELOPMENT_WORKFLOW_NS = 'development-workflow'
const TIER_KEYS: readonly DevelopmentTier[] = ['t1', 't2', 't3']

function tierDraftOf(namespace: import('@deepseek-ai/dsh-api-remotes/client').SettingsNamespaceView | undefined): DevelopmentTierDraft {
  if (namespace === undefined || typeof namespace.value !== 'object' || namespace.value === null) return {}
  const tiers = (namespace.value as { tiers?: unknown }).tiers
  if (typeof tiers !== 'object' || tiers === null) return {}
  const draft: DevelopmentTierDraft = {}
  for (const key of TIER_KEYS) {
    const route = (tiers as Record<string, unknown>)[key]
    if (typeof route !== 'object' || route === null) continue
    const provider = (route as { provider?: unknown }).provider
    const model = (route as { model?: unknown }).model
    const reasoningEffort = (route as { reasoningEffort?: unknown }).reasoningEffort
    if (typeof provider === 'string' && typeof model === 'string' && provider.length > 0 && model.length > 0) {
      draft[key] = {
        provider,
        model,
        ...typeof reasoningEffort === 'string' && reasoningEffort.length > 0 ? { reasoningEffort } : {},
      }
    }
  }
  return draft
}

function routeKey(route: DevelopmentTierSelection): string {
  return `${route.provider}\u0000${route.model}`
}

function conflictRevision(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const details = (error as { details?: unknown }).details
  if (typeof details !== 'object' || details === null) return undefined
  const actual = (details as { actual?: unknown }).actual
  return typeof actual === 'number' && Number.isSafeInteger(actual) ? actual : undefined
}

/** The host-owned T1/T2/T3 route editor shown below provider settings. */
function DevelopmentTiersCard({ state, controller, api, t }: { state: ModelsSettingsState; controller: ModelsSettingsStore; api: ModelsSectionInjected['api']; t: ModelsSectionInjected['t'] }): ReactNode {
  const namespace = state.namespaces.get(DEVELOPMENT_WORKFLOW_NS)
  const [draft, setDraft] = useState<DevelopmentTierDraft>(() => tierDraftOf(namespace))
  const [expectedRevision, setExpectedRevision] = useState<number | undefined>(() => namespace?.revision)
  const [dirty, setDirty] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    // A pushed document revision may race an open draft. Keep that draft so
    // Apply carries the revision it was edited against and can report a
    // conflict instead of silently replacing the user's work.
    if (dirty) return
    setDraft(tierDraftOf(namespace))
    setExpectedRevision(namespace?.revision)
    setDirty(false)
    setError(undefined)
  }, [namespace?.revision, dirty])

  const groups = state.modelGroups
  const failures = state.modelFailures
  const readOnly = namespace === undefined || !state.writable
  const apply = (): void => {
    if (namespace === undefined || readOnly || applying) return
    const selected = Object.fromEntries(TIER_KEYS.flatMap(key => draft[key] === undefined ? [] : [[key, draft[key]]]))
    const anySelected = Object.keys(selected).length > 0
    setApplying(true)
    setError(undefined)
    setSaved(false)
    void api.settings.mutate({
      ns: DEVELOPMENT_WORKFLOW_NS,
      ...expectedRevision === undefined ? {} : { expectedRevision },
      ops: anySelected
        ? [{ op: 'set', path: ['tiers'], value: selected }]
        : [{ op: 'unset', path: ['tiers'] }],
    }).then((response) => {
      if (!response.result.ok) {
        if (response.result.error.code === 'settings-conflict') {
          const actual = conflictRevision(response.result.error)
          if (actual !== undefined) setExpectedRevision(actual)
          setError(t('conflict'))
        } else {
          setError(response.result.error.message)
        }
        return
      }
      setDraft(tierDraftOf(response.result.value))
      setExpectedRevision(response.result.value.revision)
      setDirty(false)
      setSaved(true)
      void controller.load()
    }).catch((thrown: unknown) => {
      setError(messageOf(thrown))
    }).finally(() => { setApplying(false) })
  }

  const optionGroups = (current: DevelopmentTierSelection | undefined): ReactNode[] => {
    const known = new Set<string>()
    const result = groups.map(group => (
      <optgroup key={group.id} label={group.name}>
        {group.models.map((model) => {
          const value = routeKey({ provider: group.id, model: model.id })
          known.add(value)
          return <option key={value} value={value}>{model.name === model.id ? model.id : `${model.name} (${model.id})`}</option>
        })}
      </optgroup>
    ))
    if (current !== undefined && !known.has(routeKey(current))) {
      result.push(<optgroup key={`unavailable-${routeKey(current)}`} label={`${current.provider} (${t('tierUnavailable')})`}><option value={routeKey(current)}>{current.model} ({t('tierUnavailable')})</option></optgroup>)
    }
    return result
  }

  return (
    <section className={styles['tierCard']} aria-labelledby="development-agent-tiers">
      <h3 id="development-agent-tiers" className={styles['tierTitle']}>{t('tierTitle')}</h3>
      <p className={styles['intro']}>{t('tierIntro')}</p>
      {namespace === undefined ? <p className={styles['notice']}>{t('tierUnavailableSettings')}</p> : null}
      {state.modelCatalogError === null ? null : <p className={styles['notice']}>{`${t('tierCatalogError')}: ${state.modelCatalogError}`}</p>}
      {failures.map(failure => <p key={failure.id} className={styles['notice']}>{`${failure.name}: ${failure.message}`}</p>)}
      {TIER_KEYS.map((key) => {
        const current = draft[key]
        const reasoning = current === undefined
          ? undefined
          : groups.find(group => group.id === current.provider)?.models.find(model => model.id === current.model)?.reasoning
        const knownEfforts = reasoning?.efforts ?? []
        const effortUnavailable = current?.reasoningEffort !== undefined
          && !knownEfforts.some(effort => effort.id === current.reasoningEffort)
        const effortLabel = `${t(`tier${key.toUpperCase()}` as 'tierT1' | 'tierT2' | 'tierT3')} · ${t('tierEffort')}`
        return (
          <div key={key} className={styles['tierRow']}>
            <span className={styles['fieldLabel']}>{t(`tier${key.toUpperCase()}` as 'tierT1' | 'tierT2' | 'tierT3')}</span>
            <div className={styles['tierControls']}>
              <select
                id={`development-tier-${key}`}
                className={`${styles['input']} ${styles['selectInput']}`}
                aria-label={t(`tier${key.toUpperCase()}` as 'tierT1' | 'tierT2' | 'tierT3')}
                value={current === undefined ? '' : routeKey(current)}
                disabled={readOnly || applying}
                onChange={(event) => {
                  const value = event.target.value
                  const separator = value.indexOf('\u0000')
                  setDraft(previous => ({
                    ...previous,
                    ...(value === ''
                      ? { [key]: undefined }
                      : { [key]: { provider: value.slice(0, separator), model: value.slice(separator + 1) } }),
                  }))
                  setDirty(true)
                  setSaved(false)
                  setError(undefined)
                }}
              >
                <option value="">{t('tierInherit')}</option>
                {optionGroups(current)}
              </select>
              <select
                id={`development-tier-${key}-effort`}
                className={`${styles['input']} ${styles['selectInput']}`}
                aria-label={effortLabel}
                value={current?.reasoningEffort ?? ''}
                disabled={readOnly || applying || current === undefined || (reasoning === undefined && !effortUnavailable)}
                onChange={(event) => {
                  const value = event.target.value
                  setDraft((previous) => {
                    const route = previous[key]
                    if (route === undefined) return previous
                    const { reasoningEffort: _previousEffort, ...base } = route
                    return { ...previous, [key]: value === '' ? base : { ...base, reasoningEffort: value } }
                  })
                  setDirty(true)
                  setSaved(false)
                  setError(undefined)
                }}
              >
                <option value="">{t('tierEffortDefault')}</option>
                {knownEfforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
                {effortUnavailable ? <option value={current.reasoningEffort}>{`${current.reasoningEffort} (${t('tierUnavailable')})`}</option> : null}
              </select>
            </div>
            <p className={styles['tierHelp']}>{t(`tier${key.toUpperCase()}Help` as 'tierT1Help' | 'tierT2Help' | 'tierT3Help')}</p>
          </div>
        )
      })}
      {error === undefined ? null : <p className={styles['error']} role="alert">{error}</p>}
      {saved ? <p className={styles['savedNotice']} role="status" aria-live="polite">{t('tierSaved')}</p> : null}
      <button type="button" className={styles['primaryButton']} disabled={readOnly || !dirty || applying} onClick={apply}>{applying ? t('tierApplying') : t('tierApply')}</button>
    </section>
  )
}

/** Render an editor for either the setup posture or an expanded provider row. */
function renderProviderEditor({ target, ...props }: ProviderEditorRenderProps): ReactNode {
  return (
    <ProviderEditor
      provider={target.provider}
      displayName={target.displayName}
      settingsPath={target.settingsPath}
      {...target.declared === true ? { declared: true } : {}}
      {...props}
    />
  )
}

/**
 * Remove one user-added provider and its page-managed credential. Credential
 * removal comes first so a second-step failure leaves the provider row visible
 * and the whole operation safely retryable; both unsets are idempotent.
 * The settings removal names the profile rather than rebuilding its whole
 * namespace from a partial view.
 * @param api - settings and credential wire faces.
 * @param controller - the page store to refresh.
 * @param target - the provider's settings address and optional managed credential.
 * @returns the failure message, or undefined once the write and reload landed.
 */
export async function removeProviderProfile(
  api: Pick<IApiClient, 'settings' | 'credentials'>,
  controller: ModelsSettingsStore,
  target: { settingsNs: string; settingsPath: readonly string[]; credentialRef?: string },
): Promise<string | undefined> {
  try {
    if (target.credentialRef !== undefined) {
      const credential = await api.credentials.unset({ ref: target.credentialRef })
      if (!credential.result.ok) return credential.result.error.message
    }
    const response = await api.settings.mutate({
      ns: target.settingsNs,
      ops: [{ op: 'unset', path: [...target.settingsPath] }],
    })
    if (!response.result.ok) return response.result.error.message
  } catch (error) {
    // The transport rejected rather than answering; the caller must be able
    // to retry the idempotent operation instead of the row silently staying.
    return messageOf(error)
  }
  await controller.load()
  return undefined
}

/**
 * Whether a whole-section provider still needs its first key: an unconfigured
 * credential opens the setup card instead of showing a row. This is the
 * first-run posture alone — a user who can already reach some provider gets an
 * ordinary row with the missing-key dot, since nothing here is blocking them.
 * @param row - the joined provider row.
 * @param anyUsable - whether any joined row can already serve requests.
 * @returns whether to render the setup card.
 */
export function needsSetup(row: ProviderRow, anyUsable: boolean): boolean {
  if (anyUsable) return false
  if (row.entry.settingsPath.length > 0) return false
  return row.credential?.configured !== true
}

function targetOf(row: ProviderRow): EditorTarget {
  const managedRef = deriveKeyRef(row.entry.provider)
  const credentialRef = row.apiKeyEnv === managedRef
    && row.credential?.configured === true
    && row.credential.writable
    ? managedRef
    : undefined
  return {
    provider: row.entry.provider,
    displayName: row.entry.displayName,
    settingsNs: row.entry.settingsNs,
    settingsPath: row.entry.settingsPath,
    ...credentialRef === undefined ? {} : { credentialRef },
    // Absent is not "shipped": an adapter that answers nothing leaves the
    // route-level fields only a declared route owns off the card, exactly as
    // it leaves the custom tag off the row.
    ...row.entry.declared === true ? { declared: true } : {},
  }
}

/** Stable visible and accessible identity for one provider target. */
export function providerTargetLabel(target: ProviderIdentity): string {
  return target.provider === target.displayName
    ? target.provider
    : `${target.displayName} (${target.provider})`
}

/** Replace the one provider placeholder in localized destructive-action copy. */
export function providerCopy(template: string, target: ProviderIdentity): string {
  return template.replace('{provider}', () => providerTargetLabel(target))
}

/**
 * Render the Models section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function ModelsSection(props: ModelsSectionProps): ReactNode {
  const { controller, useSnapshot, api, t } = props
  if (controller === undefined || useSnapshot === undefined || api === undefined || t === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, api, t }} />
}

function Loaded({ injected }: { injected: ModelsSectionInjected }): ReactNode {
  const { controller, api, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [editing, setEditing] = useState<EditorTarget | undefined>(undefined)
  const [adding, setAdding] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<EditorTarget | undefined>(undefined)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailure, setDeleteFailure] = useState<string | undefined>(undefined)
  const [savedTarget, setSavedTarget] = useState<ProviderIdentity | undefined>(undefined)
  const [declaring, setDeclaring] = useState(false)
  const [dismissedSetup, setDismissedSetup] = useState<ReadonlySet<string>>(() => new Set())

  const announceSaved = (target: ProviderIdentity): void => {
    // Announced only once the refreshed directory is in the snapshot the
    // notice reads its name from: an apply can rename the route, and the
    // target captured when the card opened still carries the old name.
    void controller.load().then(() => { setSavedTarget(target) })
  }

  const closeEditor = (changed: boolean, target: ProviderIdentity): void => {
    setEditing(undefined)
    setAdding(false)
    setDeclaring(false)
    if (changed) announceSaved(target)
  }

  /**
   * Close a setup card, which owns none of the state above: the row-editor,
   * add, and declare cards each own one of those, so clearing them here would
   * discard a draft the user opened beside this card. Dismissal is this card's
   * own — the provider falls back to an ordinary row for the rest of the
   * session, and reopens through Edit.
   */
  const closeSetup = (changed: boolean, target: ProviderIdentity): void => {
    setDismissedSetup(previous => new Set([...previous, target.provider]))
    if (changed) announceSaved(target)
  }

  const closeDelete = (): void => {
    if (deleting) return
    setDeleteTarget(undefined)
    setDeleteFailure(undefined)
  }

  const confirmDelete = (): void => {
    /* v8 ignore next -- the action only renders with a target and is disabled while a deletion is pending */
    if (deleteTarget === undefined || deleting) return
    setDeleting(true)
    setDeleteFailure(undefined)
    void removeProviderProfile(api, controller, deleteTarget)
      .then((failure) => {
        if (failure !== undefined) {
          setDeleteFailure(failure)
          return
        }
        setDeleteTarget(undefined)
      })
      .finally(() => { setDeleting(false) })
  }

  if (state.status === 'idle') void controller.load()
  if (state.status === 'error') {
    /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
    const errorText = state.error ?? ''
    return (
      <div className={styles['section']}>
        <p className={styles['error']}>{`${t('loadFailed')}: ${errorText}`}</p>
        <button type="button" className={styles['secondaryButton']} onClick={() => { void controller.load() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  // The saved provider as the directory currently names it. The route id is
  // what the apply cannot change, so it is what the notice is keyed by; a row
  // the same apply removed keeps the captured identity, since nothing newer
  // exists to name it with.
  const savedRow = savedTarget === undefined
    ? undefined
    : state.rows.find(row => row.entry.provider === savedTarget.provider)
  const savedIdentity = savedRow === undefined
    ? savedTarget
    : { provider: savedRow.entry.provider, displayName: savedRow.entry.displayName }

  // One fact decides both first-run postures on this page and the onboarding
  // step: whether the user already has a provider to talk to.
  const anyUsable = state.rows.some(providerUsable)
  const configured = state.rows.filter(row => row.configured)
  const addable = state.rows.filter(row => !row.configured && row.entry.settingsNs !== '')
  const addTarget = adding ? editing : undefined
  const addNamespace = addTarget === undefined ? undefined : state.namespaces.get(addTarget.settingsNs)
  // Hand-declared routes live in the pi-ai namespace, which is also the only
  // one whose schema names the protocols one may speak; without it mounted
  // there is nothing to declare and the entry point stays disabled.
  const protocols = protocolChoices(state.namespaces.get('llm-pi-ai'))
  const providerPriority = state.namespaces.get(MODEL_PROVIDER_PRIORITY_SETTINGS_NAMESPACE)
  const orderableProviders = activeConfiguredProviderRows(state.rows)

  return (
    <div className={styles['section']}>
      <h2 className={styles['title']}>{t('title')}</h2>
      <p className={styles['intro']}>{t('intro')}</p>
      {!state.writable && state.status === 'ready' ? <p className={styles['notice']}>{t('readOnly')}</p> : null}
      <DevelopmentTiersCard state={state} controller={controller} api={api} t={t} />
      {providerPriority !== undefined
        && (orderableProviders.length > 1 || hasProviderPriority(providerPriority))
        ? (
          <ProviderOrderEditor
            rows={state.rows}
            namespace={providerPriority}
            writable={state.writable}
            api={api}
            controller={controller}
            t={t}
          />
        )
        : null}
      {savedIdentity === undefined
        ? null
        : (
          <p className={styles['savedNotice']} role="status" aria-live="polite">
            {providerCopy(t('savedProvider'), savedIdentity)}
          </p>
        )}
      <ul className={styles['rows']}>
        {configured.map((row) => {
          const target = targetOf(row)
          const namespace = state.namespaces.get(target.settingsNs)
          /* v8 ignore next -- the join marks a row configured only when its namespace resolved */
          if (namespace === undefined) return null
          if (needsSetup(row, anyUsable) && !dismissedSetup.has(row.entry.provider)) {
            // First-run posture: the provider exists but has no key — the
            // setup card IS its presence on the page, until the user closes it.
            return (
              <li key={row.entry.provider} className={styles['setupCard']}>
                {renderProviderEditor({
                  target,
                  namespace,
                  api,
                  t,
                  readOnly: !state.writable,
                  onClose: (changed) => { closeSetup(changed, target) },
                })}
              </li>
            )
          }
          const open = !adding && editing?.provider === row.entry.provider
          const credentialConfigured = row.credential?.configured === true
          const credentialMissing = !credentialConfigured
            && row.apiKeyEnv !== undefined
            && row.credential?.configured === false
          return (
            <li key={row.entry.provider} className={styles['rowCard']}>
              <div className={styles['rowHead']}>
                <span className={styles['rowIdentity']}>
                  <span className={styles['rowName']}>{row.entry.displayName}</span>
                  {/* Only the adapter can tell a hand-declared route from a
                      shipped one it also has a stored profile for, so the tag
                      follows its answer and stays off when it gives none. */}
                  {row.entry.declared === true
                    ? <span className={styles['rowTag']}>{t('customTag')}</span>
                    : null}
                  {credentialConfigured
                    ? (
                      <span
                        className={`${styles['credentialDot']} ${styles['credentialDotConfigured']}`}
                        role="img"
                        aria-label={t('credentialConfigured')}
                        title={t('credentialConfigured')}
                      />
                    )
                    : credentialMissing
                      ? (
                        <span
                          className={`${styles['credentialDot']} ${styles['credentialDotMissing']}`}
                          role="img"
                          aria-label={t('credentialMissing')}
                          title={t('credentialMissing')}
                        />
                      )
                      : null}
                </span>
                <span className={styles['rowActions']}>
                  <button
                    type="button"
                    className={styles['secondaryButton']}
                    aria-label={providerCopy(t('editProvider'), target)}
                    onClick={() => {
                      setSavedTarget(undefined)
                      // One card at a time: leaving `declaring` set would show
                      // the create card beside this editor, and closing either
                      // one discards the other's draft.
                      setDeclaring(false)
                      setAdding(false)
                      setEditing(open ? undefined : target)
                    }}
                  >
                    {t('edit')}
                  </button>
                  {row.removable
                    ? (
                      <button
                        type="button"
                        className={styles['dangerButton']}
                        aria-label={providerCopy(t('removeProvider'), target)}
                        disabled={!state.writable}
                        onClick={() => {
                          setSavedTarget(undefined)
                          setDeleteFailure(undefined)
                          setDeleteTarget(target)
                        }}
                      >
                        {t('remove')}
                      </button>
                    )
                    : null}
                </span>
              </div>
              {open
                ? renderProviderEditor({
                  target,
                  namespace,
                  api,
                  t,
                  readOnly: !state.writable,
                  onClose: (changed) => { closeEditor(changed, target) },
                })
                : null}
            </li>
          )
        })}
      </ul>
      <div className={styles['addBlock']}>
        {addTarget !== undefined && addNamespace !== undefined
          ? (
            <div className={styles['addCard']}>
              <div className={styles['field']}>
                <span className={styles['fieldLabel']}>{t('provider')}</span>
                <select
                  className={`${styles['input']} ${styles['selectInput']}`}
                  value={addTarget.provider}
                  aria-label={t('provider')}
                  onChange={(event) => {
                    const row = addable.find(candidate => candidate.entry.provider === event.target.value)
                    /* v8 ignore next -- the select only lists addable rows */
                    if (row === undefined) return
                    setEditing(targetOf(row))
                  }}
                >
                  {addable.map(row => (
                    <option key={row.entry.provider} value={row.entry.provider}>{row.entry.displayName}</option>
                  ))}
                </select>
              </div>
              <ProviderEditor
                key={addTarget.provider}
                provider={addTarget.provider}
                displayName={addTarget.displayName}
                hideTitle
                namespace={addNamespace}
                settingsPath={addTarget.settingsPath}
                api={api}
                t={t}
                readOnly={!state.writable}
                onClose={(changed) => { closeEditor(changed, addTarget) }}
              />
            </div>
          )
          : declaring
            ? (
              <div className={styles['addCard']}>
                <CustomProviderCard
                  taken={state.rows.map(row => row.entry.provider)}
                  protocols={protocols}
                  /* v8 ignore next -- the card only opens from a button disabled without this namespace */
                  revision={state.namespaces.get('llm-pi-ai')?.revision ?? 0}
                  api={api}
                  t={t}
                  readOnly={!state.writable}
                  onClose={(changed) => {
                    setDeclaring(false)
                    if (changed) void controller.load()
                  }}
                />
              </div>
            )
            : (
              // One row for the two ways to gain a provider: adopt one the
              // adapter already knows, or declare one it does not. Side by side
              // and equal-width so they read as siblings and line up with the
              // rows above, rather than two pills of different lengths.
              <div className={styles['addActions']}>
                <button
                  type="button"
                  className={styles['addButton']}
                  disabled={addable.length === 0 || !state.writable}
                  onClick={() => {
                    const first = addable[0]
                    /* v8 ignore next -- the button is disabled while nothing is addable */
                    if (first === undefined) return
                    setSavedTarget(undefined)
                    setDeclaring(false)
                    setAdding(true)
                    setEditing(targetOf(first))
                  }}
                >
                  {/* Same glyph as the composer's attach button. */}
                  <IconPlusOutline16 size={14} />
                  {t('add')}
                </button>
                <button
                  type="button"
                  className={styles['addButton']}
                  disabled={protocols.length === 0 || !state.writable}
                  onClick={() => {
                    setSavedTarget(undefined)
                    setAdding(false)
                    setEditing(undefined)
                    setDeclaring(true)
                  }}
                >
                  <IconPlusOutline16 size={14} />
                  {t('customAdd')}
                </button>
              </div>
            )}
      </div>
      <Modal
        open={deleteTarget !== undefined}
        onClose={closeDelete}
        title={deleteTarget === undefined ? '' : providerCopy(t('deleteTitle'), deleteTarget)}
        closeLabel={t('close')}
        description={deleteTarget === undefined
          ? ''
          : providerCopy(
            deleteTarget.credentialRef === undefined
              ? t('deleteDescription')
              : t('deleteDescriptionWithCredential'),
            deleteTarget,
          )}
        className={styles['deleteDialog'] as string}
        footer={(
          <>
            <Button variant="outline" autoFocus disabled={deleting} onClick={closeDelete}>
              {t('cancel')}
            </Button>
            <Button
              variant="outline"
              className={styles['deleteConfirm']}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {deleteTarget === undefined
                ? ''
                : providerCopy(deleting ? t('deleting') : t('deleteConfirm'), deleteTarget)}
            </Button>
          </>
        )}
      >
        {deleteFailure === undefined ? null : <p className={styles['error']}>{deleteFailure}</p>}
      </Modal>
    </div>
  )
}
