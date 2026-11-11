// The main process answers the window with the plugin's operation names, through the engine.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Snapshot } from '../../../core/protocol.ts'
import { handleRequests, handleViewState, type RequestEngine } from './ipc.ts'

const snapshot: Snapshot = { projects: [], attention: [], updatedAt: 1, error: null, warnings: [] }

/** An engine that records each call and answers with `snapshot`. */
function fakeEngine() {
  const calls: unknown[][] = []
  const engine: RequestEngine = {
    snapshot: () => snapshot,
    refresh: async () => (calls.push(['refresh']), snapshot),
    refreshTickets: async (projectId) => (calls.push(['refreshTickets', projectId]), snapshot),
    runSkill: async (projectId, skill, args) => (calls.push(['runSkill', projectId, skill, args]), { how: 'sent', message: 'Sent.' }),
    open: async (worktreeId) => void calls.push(['open', worktreeId]),
    reply: async (worktreeId, text) => (calls.push(['reply', worktreeId, text]), { how: 'sent', message: 'Replied.' }),
    markRead: async (worktreeId) => (calls.push(['markRead', worktreeId]), snapshot),
    setHidden: async (projectId, hidden) => (calls.push(['setHidden', projectId, hidden]), snapshot)
  }
  return { calls, engine }
}

/** Stands in for Electron's ipcMain: keeps each handler by channel. */
function fakeIpc() {
  const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>()
  return {
    ipc: { handle: (channel: string, fn: (event: unknown, input?: unknown) => unknown) => void handlers.set(channel, fn) },
    invoke: (channel: string, input?: unknown) => {
      const fn = handlers.get(channel)
      if (!fn) throw new Error(`no handler for ${channel}`)
      return fn({}, input)
    }
  }
}

test('overview.runSkill runs the skill through the engine and returns its result', async () => {
  const { calls, engine } = fakeEngine()
  const { ipc, invoke } = fakeIpc()
  handleRequests(ipc, engine)
  const result = await invoke('overview.runSkill', { projectId: 'atlas-id', skill: 'merge-tickets', args: '12' })
  assert.deepEqual(result, { how: 'sent', message: 'Sent.' })
  assert.deepEqual(calls, [['runSkill', 'atlas-id', 'merge-tickets', '12']])
})

test('overview.snapshot returns the last snapshot without refreshing', async () => {
  const { calls, engine } = fakeEngine()
  const { ipc, invoke } = fakeIpc()
  handleRequests(ipc, engine)
  assert.equal(await invoke('overview.snapshot'), snapshot)
  assert.deepEqual(calls, [])
})

test('overview.snapshot refreshes first when the engine has no snapshot yet', async () => {
  const { calls, engine } = fakeEngine()
  const { ipc, invoke } = fakeIpc()
  handleRequests(ipc, { ...engine, snapshot: () => null })
  assert.equal(await invoke('overview.snapshot'), snapshot)
  assert.deepEqual(calls, [['refresh']])
})

test('every other operation passes its input to the engine and returns its answer', async () => {
  const cases: { channel: string; input?: unknown; call: unknown[]; answer: unknown }[] = [
    { channel: 'overview.refresh', call: ['refresh'], answer: snapshot },
    { channel: 'overview.refreshTickets', input: { projectId: 'atlas-id' }, call: ['refreshTickets', 'atlas-id'], answer: snapshot },
    { channel: 'overview.open', input: { worktreeId: 'wt-1' }, call: ['open', 'wt-1'], answer: { ok: true } },
    { channel: 'overview.reply', input: { worktreeId: 'wt-1', text: 'yes' }, call: ['reply', 'wt-1', 'yes'], answer: { how: 'sent', message: 'Replied.' } },
    { channel: 'overview.markRead', input: { worktreeId: 'wt-1' }, call: ['markRead', 'wt-1'], answer: snapshot },
    { channel: 'overview.setHidden', input: { projectId: 'atlas-id', hidden: true }, call: ['setHidden', 'atlas-id', true], answer: snapshot }
  ]
  for (const c of cases) {
    const { calls, engine } = fakeEngine()
    const { ipc, invoke } = fakeIpc()
    handleRequests(ipc, engine)
    assert.deepEqual(await invoke(c.channel, c.input), c.answer, c.channel)
    assert.deepEqual(calls, [c.call], c.channel)
  }
})

test('the window saves its view state in the storage it shares with the engine', async () => {
  const values = new Map<string, unknown>()
  const storage = { get: async (key: string) => values.get(key), set: async (key: string, value: unknown) => void values.set(key, value) }
  const { ipc, invoke } = fakeIpc()
  handleViewState(ipc, storage)
  assert.deepEqual(await invoke('view.load'), { pinned: {}, minimized: {}, expanded: {} }, 'nothing saved yet')
  const state = { pinned: { 'atlas-id': true }, minimized: {}, expanded: { 'beacon-id': false } }
  await invoke('view.save', state)
  assert.deepEqual(await invoke('view.load'), state)
})
