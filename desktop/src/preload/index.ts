// Gives the window the overview's requests and snapshot events, and nothing else of Electron.
import { contextBridge, ipcRenderer } from 'electron'
import type { OverviewApi } from './api.ts'

const api: OverviewApi = {
  request: (channel, ...input) => ipcRenderer.invoke(channel, ...input),
  onSnapshot(listener) {
    const forward = (_event: unknown, s: Parameters<typeof listener>[0]) => listener(s)
    ipcRenderer.on('overview.snapshot', forward)
    return () => void ipcRenderer.removeListener('overview.snapshot', forward)
  }
}

contextBridge.exposeInMainWorld('overview', api)
