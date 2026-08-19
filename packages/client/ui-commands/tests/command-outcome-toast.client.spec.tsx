// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CommandOutcomeController,
  CommandOutcomeToast,
} from '../src/client/CommandOutcomeToast.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('frame-wide command outcome toast', () => {
  it('announces text-bearing success outside the conversation flow', () => {
    const outcomes = new CommandOutcomeController()
    render(<CommandOutcomeToast outcomes={outcomes} />)

    act(() => { outcomes.show({ kind: 'success', text: 'Signed in to anthropic.' }) })

    expect(screen.getByRole('alert').textContent).toBe('Signed in to anthropic.')
  })

  it('ignores empty results and gives failures the warning treatment', () => {
    const outcomes = new CommandOutcomeController()
    const view = render(<CommandOutcomeToast outcomes={outcomes} />)

    act(() => { outcomes.show({ kind: 'success' }) })
    expect(screen.queryByRole('alert')).toBeNull()

    act(() => { outcomes.show({ kind: 'error', text: 'Sign-in cancelled.' }) })
    expect(screen.getByRole('alert').querySelector('svg')).not.toBeNull()
    view.unmount()
    outcomes.dispose()
  })

  it('does not let an older toast completion clear its replacement', () => {
    vi.useFakeTimers()
    const outcomes = new CommandOutcomeController()
    render(<CommandOutcomeToast outcomes={outcomes} />)

    act(() => { outcomes.show({ kind: 'success', text: 'first' }) })
    const first = outcomes.state.getSnapshot()
    act(() => { outcomes.show({ kind: 'success', text: 'second' }) })
    if (first === null) throw new Error('first outcome was not published')
    act(() => { outcomes.dismiss(first.seq) })

    expect(screen.getByRole('alert').textContent).toBe('second')
    act(() => { vi.runAllTimers() })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
