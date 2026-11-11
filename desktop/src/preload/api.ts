// What the preload script exposes to the window as `window.overview`.
import type { OverviewRequests, Snapshot } from '../../../core/protocol.ts'

export interface OverviewApi {
  /** Sends one of the plugin's requests (OverviewRequests) to the main process. */
  request<K extends keyof OverviewRequests>(
    channel: K,
    ...input: OverviewRequests[K] extends { input: infer I } ? [I] : []
  ): Promise<OverviewRequests[K]['output']>
  /** Hears every new snapshot; returns a function that stops listening. */
  onSnapshot(listener: (s: Snapshot) => void): () => void
}

declare global {
  interface Window {
    overview: OverviewApi
  }
}
