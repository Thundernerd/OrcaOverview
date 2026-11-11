import { assert, mockHost, mountWorker, test } from 'orca/testing'
import type { OrcaJson } from '../core/actions.ts'
import type { EngineCli } from '../core/engine.ts'
import * as worker from './worker.ts'

const rows = [
  {
    worktreeId: 'atlas-id::/ws/atlas/main',
    repoId: 'atlas-id',
    repo: 'atlas',
    path: '/ws/atlas/main',
    displayName: 'main',
    isMainWorktree: true
  },
  {
    worktreeId: 'atlas-id::/ws/atlas/feat-a',
    repoId: 'atlas-id',
    repo: 'atlas',
    path: '/ws/atlas/feat-a',
    displayName: 'feat-a',
    parentWorktreeId: 'atlas-id::/ws/atlas/main',
    unread: true
  }
]

/** A fake `orca` CLI whose `worktree ps` lists `rows`. */
const cli: EngineCli = {
  orcaJson: (async <T>(args: string[]) => (args[1] === 'ps' ? { worktrees: rows } : {}) as T) as OrcaJson,
  surveyTickets: async () => '{}',
  surveyAvailable: () => false
}

test('answers overview.snapshot through the engine and keeps the status bar current', async () => {
  const host = mockHost({ capabilities: ['storage:own', 'notifications:show', 'workspace:read', 'workspace:write'] })
  const w = await mountWorker({ default: (orca) => worker.wire(orca, cli), deactivate: worker.deactivate }, { host })
  const snapshot = await w.request('overview.snapshot')
  assert.deepEqual(
    snapshot.projects.map((p) => p.name),
    ['atlas']
  )
  assert.deepEqual(
    snapshot.attention.map((a) => a.workspaceName),
    ['feat-a']
  )
  assert.ok(w.posts.some((p) => p.event === 'overview.snapshot'), 'the panel hears each snapshot')
  assert.equal((host.callsOf('statusBar.update').at(-1) as { text?: string } | undefined)?.text, '1 needs you')
  assert.deepEqual(w.refusals, [])
  await w.deactivate()
})
