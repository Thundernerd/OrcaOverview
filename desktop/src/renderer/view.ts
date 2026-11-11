// The window's pin, minimize and expand state. It lives in the main process, next to the engine's
// storage (hidden projects), so saved settings (#7) can keep all of it in one place.
import { useEffect, useRef, useState } from 'react'
import { EMPTY_VIEW, type OverviewApi, type ViewState } from '../preload/api.ts'

export interface View {
  state: ViewState
  /** Flips one project's pinned or minimized flag. */
  toggle(kind: 'pinned' | 'minimized', projectId: string): void
  /** Opens or closes one project's workspace table. */
  setExpanded(projectId: string, open: boolean): void
}

export function useView(api: Pick<OverviewApi, 'loadView' | 'saveView'>): View {
  const [state, setState] = useState<ViewState>(EMPTY_VIEW)
  // The latest state, also between renders, so quick changes build on each other.
  const latest = useRef(state)
  // Set by the first change: the saved state then arrives too late to apply.
  const changed = useRef(false)
  useEffect(() => {
    let live = true
    void api.loadView().then((s) => {
      if (!live || changed.current) return
      latest.current = s
      setState(s)
    })
    return () => void (live = false)
  }, [api])
  function change(next: (s: ViewState) => ViewState): void {
    changed.current = true
    latest.current = next(latest.current)
    setState(latest.current)
    void api.saveView(latest.current)
  }
  return {
    state,
    toggle: (kind, id) => change((s) => ({ ...s, [kind]: { ...s[kind], [id]: !s[kind][id] } })),
    setExpanded: (id, open) => change((s) => ({ ...s, expanded: { ...s.expanded, [id]: open } }))
  }
}
