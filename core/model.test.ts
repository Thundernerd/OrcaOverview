import { assert, test } from 'orca/testing'
import { buildSnapshot, handleForPane, isIdleClaude, keepOneActive, omittedEnvironments, omittedHosts, tagRemote, type PsWorktree } from './model.ts'
import { parseSurvey } from './survey.ts'

const NOW = 1_800_000_000_000

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
    workspaceStatus: 'in-progress',
    unread: false,
    comment: null,
    linkedIssue: null,
    linkedPR: null,
    agents: [],
    lastActivityAt: NOW - 60_000,
    ...extra
  }
}

const main = (repo: string, extra: Partial<PsWorktree> = {}) =>
  wt(repo, 'main', { isMainWorktree: true, parentWorktreeId: null, ...extra })

function snap(worktrees: PsWorktree[], hidden: string[] = []) {
  return buildSnapshot({ worktrees, tickets: {}, ticketsLoading: new Set(), hidden: new Set(hidden), now: NOW })
}

test('groups workspaces by repo with the main workspace first', () => {
  const s = snap([wt('atlas', 'feat/gh-1-a', { linkedIssue: 1 }), main('atlas'), main('beacon')])
  const gen = s.projects.find((p) => p.name === 'atlas')!
  assert.equal(gen.mainWorktreeId, 'atlas-id::/ws/atlas/main')
  assert.deepEqual(gen.workspaces.map((w) => w.name), ['main', 'feat/gh-1-a'])
  assert.equal(gen.usesTickets, true)
  assert.equal(s.projects.find((p) => p.name === 'beacon')!.usesTickets, false)
})

test('flags waiting and blocked agents, including a main agent waiting under a monitor', () => {
  const s = snap([
    main('atlas'),
    wt('atlas', 'a', { agents: [{ state: 'blocked', agentType: 'claude', stateStartedAt: NOW - 5000, lastAssistantMessage: 'May I run rm?' }] }),
    wt('atlas', 'b', { agents: [{ state: 'working', agentType: 'claude', mainAgent: { state: 'waiting' } }] }),
    wt('atlas', 'c', { agents: [{ state: 'working', agentType: 'claude', mainAgent: { state: 'done' } }] })
  ])
  const kinds = s.attention.map((a) => `${a.workspaceName}:${a.kind}`)
  assert.deepEqual(kinds.sort(), ['a:agent-waiting', 'b:agent-waiting'])
  assert.match(s.attention.find((a) => a.workspaceName === 'a')!.reason, /blocked: May I run rm\?/)
  assert.equal(s.projects[0].runningAgents, 1)
})

test('flags unread workspaces and blocked comments', () => {
  const s = snap([
    main('atlas'),
    wt('atlas', 'a', { unread: true, comment: 'https://github.com/x/y/pull/3' }),
    wt('atlas', 'b', { comment: 'blocked: needs an API key' })
  ])
  assert.deepEqual(
    s.attention.map((a) => a.reason).sort(),
    ['Unread: https://github.com/x/y/pull/3', 'blocked: needs an API key']
  )
})

test('PRs: green open is ready, red open is failing, merged is cleanable', () => {
  const s = snap([
    main('atlas'),
    wt('atlas', 'green', { linkedPR: { number: 1, state: 'open', checksStatus: 'success' } }),
    wt('atlas', 'red', { linkedPR: { number: 2, state: 'open', checksStatus: 'failure', checksSummary: { failed: 1 } } }),
    wt('atlas', 'wait', { linkedPR: { number: 3, state: 'open', checksStatus: 'pending', checksSummary: { pending: 2 } } }),
    wt('atlas', 'done', { linkedPR: { number: 4, state: 'merged', checksStatus: 'success' } })
  ])
  const p = s.projects[0]
  assert.deepEqual(s.attention.map((a) => `${a.workspaceName}:${a.kind}`).sort(), ['green:pr-ready', 'red:ci-failing'])
  assert.equal(p.openPrs, 3)
  assert.equal(p.readyPrs, 1)
  assert.equal(p.cleanupCount, 1)
  assert.equal(p.workspaces.find((w) => w.name === 'done')!.cleanable, true)
})

test('hidden projects keep their rows but leave the attention list and sort last', () => {
  const s = snap([main('Old', { unread: true, lastActivityAt: NOW }), main('atlas', { lastActivityAt: NOW - 10 })], ['Old-id'])
  assert.deepEqual(s.attention, [])
  assert.deepEqual(s.projects.map((p) => [p.name, p.hidden]), [['atlas', false], ['Old', true]])
})

test('attention lists urgent kinds first, then the longest-waiting, projects needing attention first', () => {
  const s = snap([
    main('Quiet', { lastActivityAt: NOW }),
    main('atlas', { lastActivityAt: NOW - 100 }),
    wt('atlas', 'stale', { unread: true, lastActivityAt: NOW - 99_999_999 }),
    wt('atlas', 'new', { agents: [{ state: 'waiting', stateStartedAt: NOW - 1000 }] }),
    wt('atlas', 'old', { agents: [{ state: 'waiting', stateStartedAt: NOW - 9000 }] })
  ])
  assert.deepEqual(s.attention.map((a) => a.workspaceName), ['old', 'new', 'stale'])
  assert.deepEqual(s.projects.map((p) => p.name), ['atlas', 'Quiet'])
})

test('marks the project and workspace Orca is showing', () => {
  const s = snap([main('atlas'), wt('atlas', 'feat/gh-1-a', { isActive: true }), main('beacon')])
  const gen = s.projects.find((p) => p.name === 'atlas')!
  assert.equal(gen.isActive, true)
  assert.equal(gen.activeWorkspace, 'feat/gh-1-a')
  assert.deepEqual(gen.workspaces.map((w) => w.isActive), [false, true])
  assert.equal(s.projects.find((p) => p.name === 'beacon')!.isActive, false)
})

test('reads paired servers from the hostScope ps leaves out', () => {
  assert.deepEqual(
    omittedEnvironments({
      omittedHostSelectors: [{ selector: '--environment devbox' }, { selector: '--environment "Big Box"' }, { selector: '--environment devbox' }]
    }),
    ['devbox', 'Big Box']
  )
  assert.deepEqual(omittedEnvironments(null), [])
})

test('a remote checkout is its own project, labelled with its host, sharing local ticket counts', () => {
  const remote = tagRemote('devbox', [main('example-app'), wt('example-app', 'feat/gh-311-face', { linkedIssue: 311, unread: true })])
  assert.equal(remote[0].worktreeId, 'devbox@@example-app-id::/ws/example-app/main')
  assert.equal(remote[0].rawWorktreeId, 'example-app-id::/ws/example-app/main')
  const counts = { ready: 2, blocked: 0, launched: 0, owned: 0, claimed: 1, readyTitles: [], fetchedAt: NOW, error: null }
  const s = buildSnapshot({
    worktrees: [main('example-app'), ...remote],
    tickets: { 'example-app-id': counts },
    ticketsLoading: new Set(),
    hidden: new Set(),
    now: NOW
  })
  const [local, onDevbox] = [s.projects.find((p) => !p.host)!, s.projects.find((p) => p.host === 'devbox')!]
  assert.equal(local.id, 'example-app-id')
  assert.equal(onDevbox.id, 'devbox@@example-app-id')
  assert.equal(onDevbox.ticketSource, 'example-app-id')
  assert.deepEqual(onDevbox.tickets, counts)
  assert.deepEqual(s.attention.map((a) => [a.projectId, a.worktreeId]), [['devbox@@example-app-id', 'devbox@@example-app-id::/ws/example-app/feat/gh-311-face']])
})

test('a remote project without a local checkout has no ticket source', () => {
  const s = snap(tagRemote('devbox', [main('solo')]))
  assert.equal(s.projects[0].ticketSource, null)
})

test('keeps only the active workspace Orca shows', () => {
  const rows = [main('atlas', { isActive: true }), ...tagRemote('devbox', [main('example-app', { isActive: true })])]
  const kept = keepOneActive(rows, 'devbox@@example-app-id::/ws/example-app/main')
  assert.deepEqual(kept.map((w) => w.isActive), [false, true])
})

test('one item per workspace, its reasons most urgent first', () => {
  const s = snap([
    main('atlas'),
    wt('atlas', 'both', {
      unread: true,
      comment: 'https://github.com/x/y/pull/9',
      linkedPR: { number: 9, state: 'open', checksStatus: 'success', url: 'https://github.com/x/y/pull/9' },
      lastActivityAt: NOW - 5000
    })
  ])
  assert.equal(s.attention.length, 1)
  const item = s.attention[0]
  assert.deepEqual(item.kinds, ['pr-ready', 'flagged'])
  assert.equal(item.kind, 'pr-ready')
  // The comment only repeats the PR link, so it is not shown twice.
  assert.deepEqual(item.reasons, ['PR #9 ready to merge', 'Marked unread'])
  assert.deepEqual(item.notifyKeys, ['pr-ready:atlas-id::/ws/atlas/both', 'flagged:atlas-id::/ws/atlas/both'])
  assert.equal(s.projects[0].attentionCount, 1)
})

test('while /merge-tickets runs, green PRs are not listed as ready to merge', () => {
  const green = (name: string, n: number, extra: Partial<PsWorktree> = {}) =>
    wt('atlas', name, { linkedPR: { number: n, state: 'open', checksStatus: 'success' }, ...extra })
  const red = wt('atlas', 'red', { linkedPR: { number: 9, state: 'open', checksStatus: 'failure', checksSummary: { failed: 1 } } })
  const mergingMain = main('atlas', { agents: [{ state: 'working', agentType: 'claude', prompt: '/merge-tickets', workingMode: 'monitoring' }] })
  const s = snap([mergingMain, green('a', 1), green('b', 2, { unread: true }), red])
  const p = s.projects[0]
  assert.equal(p.merging, true)
  // a disappears, b keeps only its unread flag, failing CI still needs you.
  assert.deepEqual(s.attention.map((a) => `${a.workspaceName}:${a.kinds.join('+')}`).sort(), ['b:flagged', 'red:ci-failing'])
  assert.equal(p.readyPrs, 2, 'the PR counts themselves are unchanged')

  const finished = main('atlas', { agents: [{ state: 'done', agentType: 'claude', prompt: '/merge-tickets' }] })
  assert.equal(snap([finished, green('a', 1)]).attention.length, 1, 'a finished run hides nothing')
  const other = main('atlas', { agents: [{ state: 'working', agentType: 'claude', prompt: '/launch-tickets' }] })
  assert.equal(snap([other, green('a', 1)]).projects[0].merging, false)
})

test('a merge started from the panel counts before Orca reports it', () => {
  const s = buildSnapshot({
    worktrees: [main('atlas'), wt('atlas', 'a', { linkedPR: { number: 1, state: 'open', checksStatus: 'success' } })],
    tickets: {},
    ticketsLoading: new Set(),
    hidden: new Set(),
    pendingMerges: new Set(['atlas-id']),
    now: NOW
  })
  assert.equal(s.projects[0].merging, true)
  assert.deepEqual(s.attention, [])
})

test('idle Claude sessions and pane handles', () => {
  assert.equal(isIdleClaude({ agentType: 'claude', state: 'done', hasLivePty: true }), true)
  assert.equal(isIdleClaude({ agentType: 'claude', state: 'working' }), false)
  assert.equal(isIdleClaude({ agentType: 'codex', state: 'done' }), false)
  assert.equal(isIdleClaude({ agentType: 'claude', state: 'done', mainAgent: { state: 'waiting' } }), false)
  const terms = [
    { handle: 'term_1', tabId: 't1', leafId: 'l1' },
    { handle: 'term_2', tabId: 't2', leafId: 'l2' }
  ]
  assert.equal(handleForPane('t2:l2', terms), 'term_2')
  assert.equal(handleForPane('t3:l3', terms), null)
})

test('parses the launch-tickets survey', () => {
  const out = 'source: issues (origin/main)\nready\t#68\tFix releases\t-\t68\nblocked\t#70\tB\t#68\t70\nlaunched\t#65\tTier\t-\t65\nready\t#71\tC\t-\t71\n'
  const c = parseSurvey(out, NOW)
  assert.deepEqual([c.ready, c.blocked, c.launched, c.owned, c.claimed], [2, 1, 1, 0, 0])
  assert.deepEqual(c.readyTitles, ['#68 Fix releases', '#71 C'])
})

test('lists each paired server ps left out with its host id', () => {
  assert.deepEqual(omittedHosts({ omittedHostSelectors: [{ hostId: 'runtime:7b27', selector: '--environment devbox' }] }), [
    { env: 'devbox', hostId: 'runtime:7b27' }
  ])
})
