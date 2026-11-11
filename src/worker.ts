// The overview's worker: runs the shared engine (core/engine.ts) inside Orca. It answers the panel,
// keeps the status bar item current and refreshes on Orca's workspace and agent events.
import type { JsonValue, OrcaWorkerApi } from 'orca/worker'
import { createEngine, type EngineCli } from '../core/engine.ts'
import type { Snapshot } from '../core/protocol.ts'
import { hostOpener } from './opener.ts'

const POLL_MS = 15_000

let stop: (() => void) | null = null

export default function activate(orca: OrcaWorkerApi): void {
  wire(orca)
}

export function deactivate(): void {
  stop?.()
  stop = null
}

/** Wires the engine to Orca; tests pass a fake `orca` CLI as `cli`. */
export function wire(orca: OrcaWorkerApi, cli?: EngineCli): void {
  const engine = createEngine({
    storage: {
      get: (key) => orca.storage.get(key),
      set: (key, value) => orca.storage.set(key, value as JsonValue)
    },
    notify: async (title, body) => {
      await orca.host.call('notifications.show', { title, body })
    },
    // readContext's terminal ids are CLI handles.
    focusedTerminals: async () => {
      const ctx = await orca.host.call('workspace.readContext')
      return (ctx?.terminals ?? []).map((t) => t.id)
    },
    opener: hostOpener(orca),
    pollMs: POLL_MS,
    log: (message) => orca.log(message),
    cli
  })

  engine.onSnapshot((s) => {
    orca.panels.post('overview.snapshot', s)
    void updateStatusBar(orca, s)
  })

  orca.panels.handle('overview.snapshot', async () => engine.snapshot() ?? (await engine.refresh()))
  orca.panels.handle('overview.refresh', () => engine.refresh())
  orca.panels.handle('overview.refreshTickets', ({ projectId }) => engine.refreshTickets(projectId))
  orca.panels.handle('overview.runSkill', ({ projectId, skill, args }) => engine.runSkill(projectId, skill, args))
  orca.panels.handle('overview.open', async ({ worktreeId }) => {
    await engine.open(worktreeId)
    return { ok: true as const }
  })
  orca.panels.handle('overview.reply', ({ worktreeId, text }) => engine.reply(worktreeId, text))
  orca.panels.handle('overview.markRead', ({ worktreeId }) => engine.markRead(worktreeId))
  orca.panels.handle('overview.setHidden', ({ projectId, hidden }) => engine.setHidden(projectId, hidden))

  orca.commands.register('overview.refresh', async () => {
    const s = await engine.refresh()
    return `${s.attention.length} item(s) need you.`
  })
  orca.commands.register('overview.next', () => engine.openNext())

  orca.events.on('agent.status.changed', engine.refreshSoon)
  orca.events.on('workspace.changed', engine.refreshSoon)
  orca.events.on('workspace.created', engine.refreshSoon)
  orca.events.on('workspace.removed', engine.refreshSoon)

  stop = () => engine.stop()
  engine.start()
}

async function updateStatusBar(orca: OrcaWorkerApi, s: Snapshot): Promise<void> {
  const n = s.attention.length
  const top = s.attention.slice(0, 5).map((a) => `${a.projectName} · ${a.workspaceName}: ${a.reason}`)
  await orca.host
    .call('statusBar.update', {
      id: 'attention',
      text: n === 0 ? 'All clear' : `${n} need${n === 1 ? 's' : ''} you`,
      icon: n === 0 ? 'check' : 'bell',
      tone: n === 0 ? 'neutral' : 'warning',
      tooltip: n === 0 ? 'Orca Overview: nothing needs you' : `${top.join('\n')}\nClick to open the oldest.`.slice(0, 1000)
    })
    .catch(() => undefined)
}
