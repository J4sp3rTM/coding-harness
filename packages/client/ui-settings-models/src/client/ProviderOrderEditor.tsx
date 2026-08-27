/**
 * Models-page editor for the Host-backed provider priority list. The Host
 * supplies rows in effective order; this component only filters to configured,
 * active routes and writes their complete order through `settings.mutate`.
 */

import { useEffect, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import type { IApiClient, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'
import {
  activeConfiguredProviderRows,
  hasProviderPriority,
  MODEL_PROVIDER_PRIORITY_SETTINGS_NAMESPACE,
  messageOf,
  type ModelsSettingsStore,
  type ProviderRow,
} from './store.ts'

/** Injected dependencies for the provider-order editor. */
export interface ProviderOrderEditorProps {
  /** All joined provider rows; inactive and unconfigured rows are omitted here. */
  rows: readonly ProviderRow[]
  /** Descriptor of `llm-provider-priority`, including its revision. */
  namespace: SettingsNamespaceView
  /** Whether the Host settings provider accepts writes. */
  writable: boolean
  /** Settings wire face used for the revision-fenced mutation. */
  api: Pick<IApiClient, 'settings'>
  /** Page controller refreshed after an accepted write. */
  controller: ModelsSettingsStore
  /** Localized Models-page copy. */
  t: (key: ModelsKey) => string
}

function providerLabel(row: ProviderRow): string {
  return row.entry.provider === row.entry.displayName
    ? row.entry.provider
    : `${row.entry.displayName} (${row.entry.provider})`
}

function copyFor(template: string, row: ProviderRow): string {
  return template.replace('{provider}', () => providerLabel(row))
}

function idsOf(rows: readonly ProviderRow[]): string[] {
  return activeConfiguredProviderRows(rows).map(row => row.entry.provider)
}

/**
 * Reconcile a staged order with the currently available rows. A route that
 * appears while an editor is dirty is appended, matching Host behavior for an
 * id not named in the saved priority list; routes that disappeared are pruned.
 */
function reconciledIds(staged: readonly string[], available: readonly string[]): string[] {
  const availableSet = new Set(available)
  const stagedSet = new Set<string>()
  const result: string[] = []
  for (const id of staged) {
    if (!availableSet.has(id) || stagedSet.has(id)) continue
    stagedSet.add(id)
    result.push(id)
  }
  for (const id of available) {
    if (stagedSet.has(id)) continue
    stagedSet.add(id)
    result.push(id)
  }
  return result
}

function movedIds(ids: readonly string[], source: string, target: string): string[] {
  if (source === target) return [...ids]
  const sourceIndex = ids.indexOf(source)
  const targetIndex = ids.indexOf(target)
  if (sourceIndex < 0 || targetIndex < 0) return [...ids]
  const result = [...ids]
  result.splice(sourceIndex, 1)
  // Keep the target index from the original list: after removing an item above
  // it, that index is immediately after the target; below it, before the target.
  result.splice(targetIndex, 0, source)
  return result
}

/**
 * Provider-order editor with native drag-and-drop and labelled keyboard moves.
 * A failed or conflicting write leaves the staged order visible and does not
 * announce it as saved. The Host response, rather than local state, remains
 * authoritative after a successful mutation.
 * @param props - the joined rows, Host descriptor, wire face, and copy.
 * @returns the editor card.
 */
export function ProviderOrderEditor({ rows, namespace, writable, api, controller, t }: ProviderOrderEditorProps): ReactNode {
  const availableIds = idsOf(rows)
  const availableKey = availableIds.join('\u0000')
  const [stagedIds, setStagedIds] = useState<string[]>(availableIds)
  const [expectedRevision, setExpectedRevision] = useState(namespace.revision)
  const [dirty, setDirty] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [saved, setSaved] = useState(false)
  const [draggedProvider, setDraggedProvider] = useState<string | undefined>()

  useEffect(() => {
    if (dirty) return
    setStagedIds(availableIds)
    setExpectedRevision(namespace.revision)
    setError(undefined)
  }, [availableKey, namespace.revision, dirty])

  const rowsById = new Map(activeConfiguredProviderRows(rows).map(row => [row.entry.provider, row]))
  const visibleIds = reconciledIds(stagedIds, availableIds)
  const readOnly = !writable || applying
  const hasSavedPreference = hasProviderPriority(namespace)

  const stageOrder = (next: readonly string[]): void => {
    if (readOnly) return
    const normalized = reconciledIds(next, availableIds)
    if (normalized.join('\u0000') === visibleIds.join('\u0000')) return
    setStagedIds(normalized)
    setDirty(true)
    setSaved(false)
    setError(undefined)
  }

  const move = (source: string, target: string): void => {
    stageOrder(movedIds(visibleIds, source, target))
  }

  const persist = (restoreDefault: boolean): void => {
    if (readOnly) return
    setApplying(true)
    setError(undefined)
    setSaved(false)
    void api.settings.mutate({
      ns: MODEL_PROVIDER_PRIORITY_SETTINGS_NAMESPACE,
      expectedRevision,
      ops: restoreDefault
        ? [{ op: 'unset', path: ['providers'] }]
        : [{ op: 'set', path: ['providers'], value: visibleIds }],
    }).then((response) => {
      if (!response.result.ok) {
        if (response.result.error.code === 'settings-conflict') {
          setExpectedRevision(response.result.error.details.actual)
          setError(t('providerOrderConflict'))
        } else {
          setError(response.result.error.message)
        }
        return
      }
      setExpectedRevision(response.result.value.revision)
      setDirty(false)
      setSaved(true)
      void controller.load()
    }).catch((thrown: unknown) => {
      setError(messageOf(thrown))
    }).finally(() => { setApplying(false) })
  }

  const onDragStart = (event: DragEvent<HTMLLIElement>, provider: string): void => {
    if (readOnly) return
    event.dataTransfer.setData('text/plain', provider)
    event.dataTransfer.effectAllowed = 'move'
    setDraggedProvider(provider)
  }

  const onDrop = (event: DragEvent<HTMLLIElement>, target: string): void => {
    event.preventDefault()
    move(draggedProvider ?? event.dataTransfer.getData('text/plain'), target)
    setDraggedProvider(undefined)
  }

  return (
    <section className={styles['orderCard']} aria-labelledby="provider-order-title">
      <div>
        <h3 id="provider-order-title" className={styles['orderTitle']}>{t('providerOrderTitle')}</h3>
        <p className={styles['orderIntro']}>{t('providerOrderIntro')}</p>
      </div>
      <ol className={styles['orderList']} aria-label={t('providerOrderList')}>
        {visibleIds.map((provider, index) => {
          const row = rowsById.get(provider)
          /* v8 ignore next -- reconciledIds only returns ids from available rows */
          if (row === undefined) return null
          return (
            <li
              key={provider}
              className={`${styles['orderItem']} ${draggedProvider === provider ? styles['orderItemDragging'] : ''}`}
              draggable={!readOnly}
              onDragStart={(event) => { onDragStart(event, provider) }}
              onDragOver={(event) => { if (draggedProvider !== undefined && draggedProvider !== provider) event.preventDefault() }}
              onDrop={(event) => { onDrop(event, provider) }}
              onDragEnd={() => { setDraggedProvider(undefined) }}
            >
              <span className={styles['orderDragMark']} aria-hidden="true">⠿</span>
              <span className={styles['orderIdentity']}>
                <span className={styles['orderName']}>{row.entry.displayName}</span>
                {row.entry.provider === row.entry.displayName ? null : <code className={styles['orderId']}>{row.entry.provider}</code>}
              </span>
              <span className={styles['orderMoveActions']}>
                <button
                  type="button"
                  className={styles['orderButton']}
                  aria-label={copyFor(t('moveProviderUp'), row)}
                  disabled={readOnly || index === 0}
                  onClick={() => { move(provider, visibleIds[index - 1] ?? provider) }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={styles['orderButton']}
                  aria-label={copyFor(t('moveProviderDown'), row)}
                  disabled={readOnly || index === visibleIds.length - 1}
                  onClick={() => { move(provider, visibleIds[index + 1] ?? provider) }}
                >
                  ↓
                </button>
              </span>
            </li>
          )
        })}
      </ol>
      {error === undefined ? null : <p className={styles['error']} role="alert">{error}</p>}
      {saved ? <p className={styles['savedNotice']} role="status" aria-live="polite">{t('providerOrderSaved')}</p> : null}
      <div className={styles['orderFooter']}>
        <button
          type="button"
          className={styles['secondaryButton']}
          disabled={readOnly || (!hasSavedPreference && !dirty)}
          onClick={() => { persist(true) }}
        >
          {t('providerOrderRestore')}
        </button>
        <button
          type="button"
          className={styles['primaryButton']}
          disabled={readOnly || !dirty}
          onClick={() => { persist(false) }}
        >
          {applying ? t('providerOrderApplying') : t('providerOrderApply')}
        </button>
      </div>
    </section>
  )
}
