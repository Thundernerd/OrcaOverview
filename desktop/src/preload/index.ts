// Gives the window the overview's requests, snapshot events and notification clicks, and nothing else of Electron.
import { contextBridge, ipcRenderer } from 'electron'
import type { OverviewApi } from './api.ts'

const api: OverviewApi = {
  request: (channel, ...input) => ipcRenderer.invoke(channel, ...input),
  onSnapshot(listener) {
    const forward = (_event: unknown, s: Parameters<typeof listener>[0]) => listener(s)
    ipcRenderer.on('overview.snapshot', forward)
    return () => void ipcRenderer.removeListener('overview.snapshot', forward)
  },
  onReveal(listener) {
    const forward = (_event: unknown, worktreeId: string) => listener(worktreeId)
    ipcRenderer.on('overview.reveal', forward)
    return () => void ipcRenderer.removeListener('overview.reveal', forward)
  },
  loadView: () => ipcRenderer.invoke('view.load'),
  saveView: (state) => ipcRenderer.invoke('view.save', state)
}

contextBridge.exposeInMainWorld('overview', api)
