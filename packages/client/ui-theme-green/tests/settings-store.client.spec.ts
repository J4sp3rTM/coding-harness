/** Green accent row store: snapshot-mirror action and the revision guard. */
import { describe, expect, it } from 'vitest'
import { createGreenAccentStore } from '../src/client/settings-store.ts'

describe('createGreenAccentStore', () => {
  it('init shape: default accent with revision at -1', () => {
    const store = createGreenAccentStore().create()
    expect(store.getSnapshot()).toEqual({ accent: 'default', revision: -1 })
  })

  it('sync mirrors the accent and advances the revision', () => {
    const store = createGreenAccentStore().create()
    store.actions.sync('green', 0)
    expect(store.getSnapshot()).toEqual({ accent: 'green', revision: 0 })
    store.actions.sync('default', 2)
    expect(store.getSnapshot()).toEqual({ accent: 'default', revision: 2 })
  })

  it('revision guard drops stale and duplicate writes', () => {
    const store = createGreenAccentStore().create()
    store.actions.sync('green', 3)
    store.actions.sync('default', 2)
    store.actions.sync('default', 3)
    expect(store.getSnapshot()).toEqual({ accent: 'green', revision: 3 })
  })
})
