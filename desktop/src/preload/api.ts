// What the preload script exposes to the window as `window.overview`.
import type { OverviewRequests, RequestInput, Snapshot } from '../../../core/protocol.ts'

/** How the window shows each project, by project id. Kept in the main process with the engine's storage. */
export interface ViewState {
  /** Projects kept at the top of the list. */
  pinned: Record<string, boolean>
  /** Project cards folded down to their header. */
  minimized: Record<string, boolean>
  /** Workspace tables the person opened or closed. */
  expanded: Record<string, boolean>
}

/** Nothing pinned, minimized or opened by hand. */
export const EMPTY_VIEW: ViewState = { pinned: {}, minimized: {}, expanded: {} }

export interface OverviewApi {
  /** Sends one of the plugin's requests (OverviewRequests) to the main process. */
  request<K extends keyof OverviewRequests>(
    channel: K,
    ...input: RequestInput<K> extends undefined ? [] : [RequestInput<K>]
  ): Promise<OverviewRequests[K]['output']>
  /** Hears every new snapshot; returns a function that stops listening. */
  onSnapshot(listener: (s: Snapshot) => void): () => void
  /** The window's pin, minimize and expand state. */
  loadView(): Promise<ViewState>
  saveView(state: ViewState): Promise<void>
}

declare global {
  interface Window {
    overview: OverviewApi
  }
}
