// Answers the window's requests in the main process, with the plugin's operation names
// (OverviewRequests in core/protocol.ts), by passing each one to the engine.
import type { Engine, EngineDeps } from '../../../core/engine.ts'
import type { OverviewRequests, RequestInput } from '../../../core/protocol.ts'
import { EMPTY_VIEW, type ViewState } from '../preload/api.ts'

/** The engine calls the window can reach; tests pass a fake. */
export type RequestEngine = Pick<Engine, 'snapshot' | 'refresh' | 'refreshTickets' | 'runSkill' | 'open' | 'reply' | 'markRead' | 'setHidden'>

/** Electron's ipcMain, as far as this file uses it. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, input?: any) => unknown): void
}

type Handlers = {
  [K in keyof OverviewRequests]: (input: RequestInput<K>) => Promise<OverviewRequests[K]['output']>
}

export function handleRequests(ipc: IpcMainLike, engine: RequestEngine): void {
  const handlers: Handlers = {
    'overview.snapshot': async () => engine.snapshot() ?? (await engine.refresh()),
    'overview.refresh': () => engine.refresh(),
    'overview.refreshTickets': ({ projectId }) => engine.refreshTickets(projectId),
    'overview.runSkill': ({ projectId, skill, args }) => engine.runSkill(projectId, skill, args),
    'overview.open': async ({ worktreeId }) => {
      await engine.open(worktreeId)
      return { ok: true as const }
    },
    'overview.reply': ({ worktreeId, text }) => engine.reply(worktreeId, text),
    'overview.markRead': ({ worktreeId }) => engine.markRead(worktreeId),
    'overview.setHidden': ({ projectId, hidden }) => engine.setHidden(projectId, hidden)
  }
  for (const [channel, handler] of Object.entries(handlers) as [string, (input: unknown) => unknown][]) {
    ipc.handle(channel, (_event, input) => handler(input))
  }
}

/** The storage key of the window's pin, minimize and expand state. */
const K_VIEW = 'view'

/**
 * Keeps the window's view state (preload's loadView/saveView) in the storage the engine keeps
 * hidden projects in: the settings file, so it survives a restart.
 */
export function handleViewState(ipc: IpcMainLike, storage: EngineDeps['storage']): void {
  ipc.handle('view.load', async () => ((await storage.get(K_VIEW)) as ViewState | undefined) ?? EMPTY_VIEW)
  ipc.handle('view.save', (_event, state: ViewState) => storage.set(K_VIEW, state))
}
