import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Opener, OrcaJson } from './actions.ts'
import { createEngine, type EngineCli, type EngineDeps } from './engine.ts'
import type { PsWorktree } from './model.ts'

function wt(repo: string, name: string, extra: Partial<PsWorktree> = {}): PsWorktree {
  return {
    worktreeId: `${repo}-id::/ws/${repo}/${name}`,
    repoId: `${repo}-id`,
    repo,
    path: `/ws/${repo}/${name}`,
    branch: `refs/heads/${name}`,
    displayName: name,
    isMainWorktree: false,
    parentWorktreeId: `${repo}-id::/ws/${repo}/main`,
    agents: [],
    lastActivityAt: Date.now() - 60_000,
    ...extra
  }
}

const main = (repo: string, extra: Partial<PsWorktree> = {}) => wt(repo, 'main', { isMainWorktree: true, parentWorktreeId: null, ...extra })

/** A fake `orca` CLI: `worktree ps` lists `rows`, every other call answers `{}`. */
function fakeCli(rows: PsWorktree[] = []) {
  const cli = {
    rows,
    calls: [] as string[][],
    surveys: [] as string[],
    /** Settles the surveys started so far, in order. */
    finishSurveys: [] as (() => void)[],
    surveyAvailable: false
  }
  const orcaJson: OrcaJson = async <T>(args: string[]) => {
    cli.calls.push(args)
    if (args[0] === 'worktree' && args[1] === 'ps') return { worktrees: cli.rows } as T
    if (args[0] === 'terminal' && args[1] === 'list') return { terminals: [] } as T
    return {} as T
  }
  const engineCli: EngineCli = {
    orcaJson,
    surveyAvailable: () => cli.surveyAvailable,
    surveyTickets: (cwd) =>
      new Promise((resolve) => {
        cli.surveys.push(cwd)
        cli.finishSurveys.push(() => resolve('{}'))
      })
  }
  return { cli, engineCli }
}

function fakeDeps(engineCli: EngineCli, extra: Partial<EngineDeps> = {}) {
  const stored = new Map<string, unknown>()
  const notes: { title: string; body: string }[] = []
  const opener: Opener = { open: async () => undefined }
  const deps: EngineDeps = {
    storage: {
      get: async (key) => stored.get(key) ?? null,
      set: async (key, value) => {
        stored.set(key, value)
      }
    },
    notify: async (title, body) => {
      notes.push({ title, body })
    },
    opener,
    pollMs: 60_000,
    cli: engineCli,
    ...extra
  }
  return { deps, stored, notes }
}

const mergeAgent = (state: string) => ({ agentType: 'claude', state, prompt: '/merge-tickets', paneKey: 't:l' })

test('runSkill merge-tickets counts as a merge until ps reports one, and not after it ends', async () => {
  const { cli, engineCli } = fakeCli([main('atlas')])
  const engine = createEngine(fakeDeps(engineCli).deps)
  await engine.refresh()

  await engine.runSkill('atlas-id', 'merge-tickets')
  assert.equal(engine.snapshot()?.projects[0].merging, true, 'merging right after the click')

  cli.rows = [main('atlas', { agents: [mergeAgent('working')] })]
  assert.equal((await engine.refresh()).projects[0].merging, true, 'merging while ps reports it')

  cli.rows = [main('atlas', { agents: [mergeAgent('done')] })]
  assert.equal((await engine.refresh()).projects[0].merging, false, 'the click no longer counts once ps reported the run')
  engine.stop()
})

test('new attention notifies once, and a new kind on the same workspace notifies again', async () => {
  const { cli, engineCli } = fakeCli([main('atlas'), wt('atlas', 'feat-a')])
  const { deps, notes } = fakeDeps(engineCli)
  const engine = createEngine(deps)
  await engine.refresh()

  cli.rows = [main('atlas'), wt('atlas', 'feat-a', { unread: true })]
  await engine.refresh()
  await engine.refresh()
  assert.deepEqual(notes, [{ title: 'atlas · feat-a', body: 'Marked unread' }])

  cli.rows = [main('atlas'), wt('atlas', 'feat-a', { unread: true, linkedPR: { number: 7, state: 'open', checksStatus: 'failure' } })]
  await engine.refresh()
  assert.deepEqual(notes.at(-1), { title: 'atlas · feat-a', body: 'PR #7 CI failing' })
  assert.equal(notes.length, 2)
  engine.stop()
})

test('the first run ever announces nothing that is already there', async () => {
  const { engineCli } = fakeCli([main('atlas'), wt('atlas', 'feat-a', { unread: true })])
  const { deps, notes } = fakeDeps(engineCli)
  await createEngine(deps).refresh()
  assert.deepEqual(notes, [])
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('stale surveys run at most two at a time, and the next starts when one ends', async () => {
  const repos = ['atlas', 'beacon', 'comet']
  const { cli, engineCli } = fakeCli(repos.flatMap((r) => [main(r), wt(r, 'feat-gh-1-a', { linkedIssue: 1 })]))
  cli.surveyAvailable = true
  const engine = createEngine(fakeDeps(engineCli).deps)
  await engine.refresh()
  await settle()
  assert.deepEqual(cli.surveys, ['/ws/atlas/main', '/ws/beacon/main'])

  await engine.refresh()
  await settle()
  assert.equal(cli.surveys.length, 2, 'a refresh does not queue a survey twice')

  cli.finishSurveys[0]()
  await settle()
  assert.deepEqual(cli.surveys, ['/ws/atlas/main', '/ws/beacon/main', '/ws/comet/main'])
  engine.stop()
})

test('a stopped engine does not refresh on a later refreshSoon', async () => {
  const { cli, engineCli } = fakeCli([main('atlas')])
  const engine = createEngine(fakeDeps(engineCli).deps)
  engine.stop()
  engine.refreshSoon()
  await new Promise((resolve) => setTimeout(resolve, 700))
  assert.deepEqual(cli.calls, [])
})
