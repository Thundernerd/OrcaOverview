// Sample data for panel tests and `orca plugin check` scenarios.
import { buildSnapshot, tagRemote, type PsWorktree } from './model.ts'
import type { Snapshot } from './protocol.ts'

export const NOW = 1_790_000_000_000

function wt(repo: string, name: string, extra: Partial<PsWorktree> = {}): PsWorktree {
  return {
    worktreeId: `${repo}-id::/ws/${repo}/${name}`,
    repoId: `${repo}-id`,
    repo,
    path: `/ws/${repo}/${name}`,
    branch: `refs/heads/${name}`,
    displayName: name,
    parentWorktreeId: `${repo}-id::/ws/${repo}/main`,
    workspaceStatus: 'in-progress',
    lastActivityAt: NOW - 120_000,
    ...extra
  }
}

const main = (repo: string, extra: Partial<PsWorktree> = {}) =>
  wt(repo, 'main', { isMainWorktree: true, parentWorktreeId: null, ...extra })

export const busyWorktrees: PsWorktree[] = [
  main('atlas', { agents: [{ state: 'done', agentType: 'claude', paneKey: 't:l' }] }),
  wt('atlas', 'feat/gh-60-non-csharp-engines', {
    linkedIssue: 60,
    workspaceStatus: 'in-review',
    linkedPR: { number: 69, state: 'open', checksStatus: 'success' },
    unread: true,
    comment: 'https://github.com/example/atlas/pull/69'
  }),
  wt('atlas', 'refactor/gh-65-tier-type', {
    linkedIssue: 65,
    agents: [{ state: 'blocked', agentType: 'claude', stateStartedAt: NOW - 600_000, lastAssistantMessage: 'Should tiers be an enum or a newtype?' }]
  }),
  wt('atlas', 'feat/gh-59-language-neutral-tiers', { linkedIssue: 59, linkedPR: { number: 66, state: 'merged', checksStatus: 'success' } }),
  main('beacon', { isActive: true }),
  wt('beacon', 'ci/gh-3-smoke-test', {
    linkedIssue: 3,
    linkedPR: { number: 5, state: 'open', checksStatus: 'failure', checksSummary: { failed: 1 } },
    agents: [{ state: 'working', agentType: 'claude', stateStartedAt: NOW - 30_000 }]
  }),
  main('Quiet', { lastActivityAt: NOW - 86_400_000 }),
  ...tagRemote('devbox', [main('example-app', { lastActivityAt: NOW - 90_000_000 }), wt('example-app', 'feat/gh-311-face', { linkedIssue: 311, unread: true, lastActivityAt: NOW - 3_000_000 })])
]

export function busySnapshot(): Snapshot {
  return buildSnapshot({
    worktrees: busyWorktrees,
    tickets: {
      'atlas-id': { ready: 1, blocked: 2, launched: 2, owned: 0, claimed: 0, readyTitles: ['#68 Releases miss tags'], fetchedAt: NOW - 60_000, error: null }
    },
    ticketsLoading: new Set(['beacon-id']),
    hidden: new Set(),
    now: NOW
  })
}

export function quietSnapshot(): Snapshot {
  return buildSnapshot({ worktrees: [main('Quiet')], tickets: {}, ticketsLoading: new Set(), hidden: new Set(), now: NOW })
}
