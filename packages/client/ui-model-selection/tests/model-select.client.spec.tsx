// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { en } from '../src/client/locales.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key]
    ?? (commonEn as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const reasoning = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max', description: 'Largest budget' },
  ],
  defaultEffort: 'high',
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning }],
    }],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

afterEach(cleanup)

describe('ModelSelect model filtering', () => {
  const groups = [{
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
    ],
  }, {
    id: 'open-router',
    name: 'Open Router',
    models: [
      { id: 'qwen3-coder', name: 'Qwen3 Coder' },
      { id: 'llama-4', name: 'Llama 4' },
    ],
  }]

  function renderSelector() {
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const view = render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)
    fireEvent.click(screen.getByRole('button', { name: /Select model/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Model/ }))
    return view
  }

  it('opens the model pane with a prominent focused search field', () => {
    renderSelector()
    const search = screen.getByRole('searchbox', { name: 'Search models' })
    expect(document.activeElement).toBe(search)
    expect(search.getAttribute('placeholder')).toBe('Search models')
    fireEvent.change(search, { target: { value: 'deep' } })
    expect(screen.getByText('DeepSeek')).toBeTruthy()
    expect(screen.queryByText('Open Router')).toBeNull()
  })

  it('filters by provider or model metadata from the search field', () => {
    renderSelector()
    const search = screen.getByRole('searchbox', { name: 'Search models' })
    fireEvent.change(search, { target: { value: 'deep' } })
    expect(screen.getByText('DeepSeek')).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Pro' })).toBeTruthy()
    expect(screen.queryByText('Open Router')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Select model/ }))
    fireEvent.click(screen.getByRole('button', { name: /Select model/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Model/ }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), { target: { value: 'qwen3' } })
    expect(screen.getByText('Open Router')).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'Qwen3 Coder' })).toBeTruthy()
    expect(screen.queryByRole('menuitemradio', { name: 'Llama 4' })).toBeNull()
  })

  it('edits the search, focuses visible rows, and reports localized no-results', () => {
    renderSelector()
    const search = screen.getByRole('searchbox', { name: 'Search models' })
    fireEvent.change(search, { target: { value: 'QWE' } })
    expect(search).toHaveProperty('value', 'QWE')
    fireEvent.change(search, { target: { value: 'QW' } })
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Qwen3 Coder' }))
    if (!(document.activeElement instanceof HTMLElement)) throw new Error('Model row did not receive focus')
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Qwen3 Coder' }))

    fireEvent.change(search, { target: { value: 'QWmissing' } })
    expect(screen.getByText('No models match “QWmissing”.')).toBeTruthy()
    expect(screen.queryByRole('menuitemradio')).toBeNull()
  })

  it('accepts spaces as normal search input', () => {
    renderSelector()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), {
      target: { value: 'open router' },
    })
    expect(screen.getByRole('menuitemradio', { name: 'Qwen3 Coder' })).toBeTruthy()
    expect(screen.queryByText('DeepSeek')).toBeNull()
  })

  it('clears the search when closed and leaves the root pane unchanged', () => {
    renderSelector()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), { target: { value: 'deep' } })
    fireEvent.click(screen.getByRole('button', { name: /Select model/ }))
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Select model/ }))
    expect(screen.queryByRole('searchbox')).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /Model/ }))
    expect(screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search models' }).value).toBe('')
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(4)
  })

  it('clears the search when an outside click closes the menu', () => {
    renderSelector()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), { target: { value: 'deep' } })
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Select model/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Model/ }))
    expect(screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search models' }).value).toBe('')
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(4)
  })
})

describe('ModelSelect reasoning effort', () => {
  it('renders adapter metadata and submits the effort as part of the session selection', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return true
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', {
      name: 'Select model, current DeepSeek-V4-Flash, reasoning effort High',
    })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /Effort/ }))
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Off' }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Off', 'High', 'MaxLargest budget'])

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Max/ }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      })
      expect(trigger.getAttribute('aria-label')).toBe('Select model, current DeepSeek-V4-Flash, reasoning effort Max')
    })
  })

  it('offers provider default only when the adapter does not configure a model default', () => {
    const directory = createSnapshotStore(state({
      groups: [{
        id: 'provider',
        name: 'Provider',
        models: [{
          id: 'model',
          name: 'Model',
          reasoning: { efforts: [{ id: 'standard', name: 'Standard' }] },
        }],
      }],
      current: { provider: 'provider', model: 'model' },
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: 'Select model, current Model, reasoning effort Default',
    }))
    // The menu nests: the Effort cell opens the effort option radios.
    fireEvent.click(screen.getByRole('menuitem', { name: 'EffortDefault' }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Default', 'Standard'])
  })

  it('prompts for a selection when the current model is no longer advertised', () => {
    const directory = createSnapshotStore(state({
      current: { provider: 'deepseek-official', model: 'removed-model' },
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: 'Select model' })
    expect(trigger.textContent).toContain('Select model')
    fireEvent.click(trigger)
    expect(screen.queryByRole('menuitem', { name: /Effort/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /Model/ }))
    expect(screen.queryByText('removed-model')).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeTruthy()
  })

  it('announces a rejected selection as a transient toast and keeps the in-menu strip for loads', async () => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const select = vi.fn(async () => {
      directory.set(state({ groups, status: 'error', error: 'model-unavailable: session already contains images' }))
      return false
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Select model/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Model/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }))
    const toast = await screen.findByRole('alert')
    expect(toast.textContent).toContain('Model operation failed: model-unavailable: session already contains images')
    // The selection failure does not render the in-menu load strip (no Retry).
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('renders no Agent-bound control for an addressed subagent session', () => {
    const load = vi.fn()
    render(<ModelSelect
      locked={false}
      available={false}
      directory={createSnapshotStore(state())}
      load={load}
      select={vi.fn().mockResolvedValue(false)}
      t={t}
    />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})
