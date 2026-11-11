// Gives the window the overview's requests, snapshots and notification clicks, and nothing else of Electron.
import { contextBridge, ipcRenderer } from 'electron'
import type { OverviewApi } from './api.ts'

// The main process sends a notification click once the page has loaded, which can be just before the
// window starts listening. Keep the last one until it does.
const revealListeners = new Set<(worktreeId: string) => void>()
let unheardReveal: string | null = null
ipcRenderer.on('overview.reveal', (_event, worktreeId: string) => {
  if (revealListeners.size === 0) unheardReveal = worktreeId
  else for (const listener of revealListeners) listener(worktreeId)
})

const api: OverviewApi = {
  request: (channel, ...input) => ipcRenderer.invoke(channel, ...input),
  onSnapshot(listener) {
    const forward = (_event: unknown, s: Parameters<typeof listener>[0]) => listener(s)
    ipcRenderer.on('overview.snapshot', forward)
    return () => void ipcRenderer.removeListener('overview.snapshot', forward)
  },
  onReveal(listener) {
    revealListeners.add(listener)
    if (unheardReveal !== null) {
      const worktreeId = unheardReveal
      unheardReveal = null
      listener(worktreeId)
    }
    return () => void revealListeners.delete(listener)
  },
  loadView: () => ipcRenderer.invoke('view.load'),
  saveView: (state) => ipcRenderer.invoke('view.save', state)
}

contextBridge.exposeInMainWorld('overview', api)
