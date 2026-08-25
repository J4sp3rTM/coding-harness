/**
 * Green Accent settings row registered into the General section item slot.
 * Selection follows the persisted accent; clicks write through setAccent.
 */
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { GreenAccentId } from '../accent.ts'
import type { createGreenAccentStore } from './settings-store.ts'
import css from './GreenAccentRow.module.css'

/** Injected business face: the accent write (t rides the standard locale seat). */
export interface GreenAccentRowInjected {
  /** Switch the green accent. */
  setAccent: (id: GreenAccentId) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type GreenAccentRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createGreenAccentStore>>
  & PropsLocale<'settings.themeGreen'> & GreenAccentRowInjected

const CHOICES: readonly { id: GreenAccentId; labelKey: 'accent.default' | 'accent.green' }[] = [
  { id: 'default', labelKey: 'accent.default' },
  { id: 'green', labelKey: 'accent.green' },
]

/**
 * Render the Green Accent row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function GreenAccentRow({ t, setAccent, useStore }: GreenAccentRowComponentProps) {
  const accent = useStore(s => s.accent)
  return (
    <div className={css.group}>
      <div className={css.title}>{t('accent.title')}</div>
      <div className={css.cubeRow}>
        {CHOICES.map(({ id, labelKey }) => (
          <button
            key={id}
            type="button"
            className={clsx(css.themeCube, accent === id && css.selected)}
            aria-pressed={accent === id}
            onClick={() => { setAccent(id) }}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
    </div>
  )
}
