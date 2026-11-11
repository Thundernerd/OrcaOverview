// The window's pin, minimize and expand state. It lives in the main process, next to the engine's
// storage (hidden projects), so saved settings (#7) can keep all of it in one place.
import { useEffect, useState } from 'react'
import type { OverviewApi, ViewState } from '../preload/api.ts'

export const EMPTY_VIEW: ViewState = { pinned: {}, minimized: {}, expanded: {} }

export interface View {
  state: ViewState
  /** Flips one project's pinned or minimized flag. */
  toggle(kind: 'pinned' | 'minimized', projectId: string): void
  /** Opens or closes one project's workspace table. */
  setExpanded(projectId: string, open: boolean): void
}

export function useView(api: Pick<OverviewApi, 'loadView' | 'saveView'>): View {
  const [state, setState] = useState<ViewState>(EMPTY_VIEW)
  useEffect(() => {
    let live = true
    void api.loadView().then((s) => live && setState(s))
    return () => void (live = false)
  }, [api])
  function change(next: (s: ViewState) => ViewState): void {
    const updated = next(state)
    setState(updated)
    void api.saveView(updated)
  }
  return {
    state,
    toggle: (kind, id) => change((s) => ({ ...s, [kind]: { ...s[kind], [id]: !s[kind][id] } })),
    setExpanded: (id, open) => change((s) => ({ ...s, expanded: { ...s.expanded, [id]: open } }))
  }
}
