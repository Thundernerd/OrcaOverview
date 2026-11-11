// Pure: turns `orca worktree ps --json` rows (plus cached ticket counts) into the overview.
import type {
  AttentionItem,
  AttentionKind,
  PrInfo,
  Project,
  Snapshot,
  TicketCounts,
  WorkspaceRow
} from './protocol.ts'

/** The fields of a `worktree ps` row this plugin reads. Everything is optional: Orca adds fields. */
export interface PsAgent {
  paneKey?: string
  state?: string
  agentType?: string
  lastAssistantMessage?: string | null
  stateStartedAt?: number
  hasLivePty?: boolean
  mainAgent?: { state?: string; stateStartedAt?: number } | null
  /** The prompt the agent is working on, e.g. `/merge-tickets`. */
  prompt?: string | null
  /** `monitoring` while it waits on a background job (e.g. CI) between turns. */
  workingMode?: string | null
}

export interface PsWorktree {
  /** Unique across hosts: a remote row's id is prefixed with its environment (see tagRemote). */
  worktreeId: string
  /** The id the row's own host knows it by. */
  rawWorktreeId?: string
  /** The paired server it lives on; absent on this machine. */
  env?: string | null
  repoId: string
  repo: string
  path: string
  branch?: string | null
  displayName?: string | null
  isMainWorktree?: boolean
  isArchived?: boolean
  isActive?: boolean
  parentWorktreeId?: string | null
  workspaceStatus?: string | null
  unread?: boolean
  comment?: string | null
  linkedIssue?: number | { number: number } | null
  linkedPR?: {
    number: number
    state?: string
    url?: string
    checksStatus?: string
    checksSummary?: { failed?: number; pending?: number; total?: number }
  } | null
  agents?: PsAgent[] | null
  lastActivityAt?: number | null
  stateStartedAt?: number
}

export interface ModelInput {
  worktrees: PsWorktree[]
  tickets: Record<string, TicketCounts>
  ticketsLoading: ReadonlySet<string>
  /** Projects where /merge-tickets was just started from the panel, before Orca reports it. */
  pendingMerges?: ReadonlySet<string>
  hidden: ReadonlySet<string>
  now: number
  error?: string | null
  warnings?: string[]
}

/** Makes a paired server's rows unique next to local ones and remembers where they live. */
export function tagRemote(env: string, rows: PsWorktree[]): PsWorktree[] {
  return rows.map((w) => ({
    ...w,
    env,
    rawWorktreeId: w.worktreeId,
    worktreeId: `${env}@@${w.worktreeId}`,
    repoId: `${env}@@${w.repoId}`
  }))
}

/** The environment names `worktree ps` left out: `--environment devbox` selectors in its hostScope. */
export function omittedEnvironments(hostScope: HostScope): string[] {
  return omittedHosts(hostScope).map((h) => h.env)
}

type HostScope = { omittedHostSelectors?: { selector?: string; hostId?: string }[] } | null | undefined

/** Each paired server ps left out: its `--environment` name and this machine's host id for it. */
export function omittedHosts(hostScope: HostScope): { env: string; hostId: string | null }[] {
  const hosts: { env: string; hostId: string | null }[] = []
  for (const s of hostScope?.omittedHostSelectors ?? []) {
    const m = /--environment\s+(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(s.selector ?? '')
    const env = m?.[1] ?? m?.[2] ?? m?.[3]
    if (env && !hosts.some((h) => h.env === env)) hosts.push({ env, hostId: s.hostId ?? null })
  }
  return hosts
}

/** Every host keeps its own last-focused workspace; keep only the one Orca shows (`keepId`). */
export function keepOneActive(rows: PsWorktree[], keepId: string | null): PsWorktree[] {
  return rows.map((w) => (w.isActive && w.worktreeId !== keepId ? { ...w, isActive: false } : w))
}

const TICKET_BRANCH = /(^|[-/])(gh|issue)-\d+-/
const KIND_RANK: Record<AttentionKind, number> = { 'agent-waiting': 0, 'ci-failing': 1, 'pr-ready': 2, flagged: 3 }
const STATE_RANK: Record<string, number> = { blocked: 4, waiting: 3, working: 2, done: 1 }

export function shortBranch(branch: string | null | undefined): string {
  return (branch ?? '').replace(/^refs\/heads\//, '')
}

function issueNumber(w: PsWorktree): number | null {
  const l = w.linkedIssue
  if (typeof l === 'number') return l
  if (l && typeof l === 'object' && typeof l.number === 'number') return l.number
  return null
}

export function prInfo(w: PsWorktree): PrInfo | null {
  const pr = w.linkedPR
  if (!pr || typeof pr.number !== 'number') return null
  const status = (pr.checksStatus ?? '').toLowerCase()
  const summary = pr.checksSummary ?? {}
  let checks: PrInfo['checks'] = 'none'
  if ((summary.failed ?? 0) > 0 || ['failure', 'failed', 'error'].includes(status)) checks = 'failure'
  else if ((summary.pending ?? 0) > 0 || status === 'pending') checks = 'pending'
  else if (status === 'success') checks = 'success'
  return { number: pr.number, state: (pr.state ?? 'unknown').toLowerCase(), checks, url: pr.url ?? null }
}

/** The states an agent reports: its own, and its main agent's (set while it monitors a wait). */
function agentStates(a: PsAgent): string[] {
  return [a.state, a.mainAgent?.state].filter((s): s is string => typeof s === 'string')
}

export function isWaiting(a: PsAgent): boolean {
  return agentStates(a).some((s) => s === 'blocked' || s === 'waiting')
}

/** An agent that will take a new prompt right now: a live Claude session that finished its turn. */
export function isIdleClaude(a: PsAgent): boolean {
  return a.agentType === 'claude' && a.hasLivePty !== false && a.state === 'done' && !isWaiting(a)
}

function mostUrgent(agents: PsAgent[]): PsAgent | null {
  let best: PsAgent | null = null
  let bestRank = 0
  for (const a of agents) {
    const rank = Math.max(0, ...agentStates(a).map((s) => STATE_RANK[s] ?? 0))
    if (rank > bestRank) {
      best = a
      bestRank = rank
    }
  }
  return best
}

function urgentState(a: PsAgent | null): WorkspaceRow['agentState'] {
  if (!a) return null
  const states = agentStates(a)
  for (const s of ['blocked', 'waiting', 'working', 'done'] as const) if (states.includes(s)) return s
  return null
}

function truncate(text: string | null | undefined, max: number): string | null {
  if (!text) return null
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

interface Condition {
  kind: AttentionKind
  reason: string
  since: number | null
}

/** One item per workspace: its conditions, most urgent first. */
export function mergeConditions(
  w: { worktreeId: string },
  workspaceName: string,
  conditions: Condition[]
): Omit<AttentionItem, 'projectId' | 'projectName'> | null {
  if (conditions.length === 0) return null
  const sorted = [...conditions].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])
  const times = sorted.map((c) => c.since).filter((t): t is number => t !== null)
  return {
    key: `ws:${w.worktreeId}`,
    kind: sorted[0].kind,
    kinds: sorted.map((c) => c.kind),
    reasons: sorted.map((c) => c.reason),
    reason: sorted.map((c) => c.reason).join(' · '),
    notifyKeys: sorted.map((c) => `${c.kind}:${w.worktreeId}`),
    worktreeId: w.worktreeId,
    workspaceName,
    since: times.length ? Math.min(...times) : null
  }
}

/** A /merge-tickets run is still going in this workspace: working, waiting on CI, or asking. */
export function isMerging(w: PsWorktree | null): boolean {
  return (w?.agents ?? []).some(
    (a) => /^\/merge-tickets\b/.test(a.prompt?.trim() ?? '') && (a.state !== 'done' || a.workingMode === 'monitoring' || isWaiting(a))
  )
}

function workspaceRow(w: PsWorktree, isMain: boolean, merging = false): { row: WorkspaceRow; item: Omit<AttentionItem, 'projectId' | 'projectName'> | null } {
  const agents = w.agents ?? []
  const urgent = mostUrgent(agents)
  const pr = prInfo(w)
  const name = w.displayName || shortBranch(w.branch) || w.path
  const comment = w.comment?.trim() || null
  const items: Condition[] = []
  const add = (kind: AttentionKind, reason: string, since: number | null) => items.push({ kind, reason, since })

  const waiting = agents.filter(isWaiting)
  if (waiting.length > 0) {
    const a = waiting[0]
    const state = urgentState(a)
    const msg = truncate(a.lastAssistantMessage, 140)
    add('agent-waiting', `Agent ${state}${msg ? `: ${msg}` : ''}`, a.stateStartedAt ?? null)
  }
  if (comment && /^blocked:/i.test(comment)) add('flagged', comment, w.lastActivityAt ?? null)
  // A comment that is only the PR's link says nothing the PR line does not.
  else if (w.unread) {
    const saysMore = comment && !(pr?.url && comment === pr.url)
    add('flagged', saysMore ? `Unread: ${truncate(comment, 140)}` : 'Marked unread', w.lastActivityAt ?? null)
  }
  if (pr && pr.state === 'open' && pr.checks === 'failure') add('ci-failing', `PR #${pr.number} CI failing`, w.lastActivityAt ?? null)
  // While /merge-tickets runs it works through every green PR, so they need nothing from you.
  else if (pr && pr.state === 'open' && pr.checks === 'success' && !merging) add('pr-ready', `PR #${pr.number} ready to merge`, w.lastActivityAt ?? null)

  const merged = pr?.state === 'merged'
  const row: WorkspaceRow = {
    worktreeId: w.worktreeId,
    name,
    isMain,
    isActive: w.isActive === true,
    status: w.workspaceStatus ?? null,
    issue: issueNumber(w),
    pr,
    agentState: urgentState(urgent),
    agentSince: urgent?.stateStartedAt ?? null,
    lastMessage: truncate(urgent?.lastAssistantMessage, 200),
    comment,
    unread: w.unread === true,
    lastActivityAt: w.lastActivityAt ?? null,
    attention: items.map((i) => i.kind),
    cleanable: !isMain && (merged || w.workspaceStatus === 'completed')
  }
  return { row, item: mergeConditions(w, name, items) }
}

function pickMain(rows: PsWorktree[]): PsWorktree | null {
  return rows.find((w) => w.isMainWorktree) ?? rows.find((w) => !w.parentWorktreeId) ?? null
}

export function usesTickets(rows: PsWorktree[]): boolean {
  return rows.some((w) => issueNumber(w) !== null || TICKET_BRANCH.test(shortBranch(w.branch)) || TICKET_BRANCH.test(w.displayName ?? ''))
}

export function buildSnapshot(input: ModelInput): Snapshot {
  const byRepo = new Map<string, PsWorktree[]>()
  for (const w of input.worktrees) {
    if (w.isArchived) continue
    const list = byRepo.get(w.repoId) ?? []
    list.push(w)
    byRepo.set(w.repoId, list)
  }

  const projects: Project[] = []
  const attention: AttentionItem[] = []
  // A remote project shows the ticket counts of a local checkout of the same repo: issues live on GitHub.
  const localByName = new Map<string, string>()
  for (const w of input.worktrees) if (!w.env && !localByName.has(w.repo)) localByName.set(w.repo, w.repoId)
  for (const [repoId, rows] of byRepo) {
    const main = pickMain(rows)
    const merging = isMerging(main) || (input.pendingMerges?.has(repoId) ?? false)
    const projectName = rows[0].repo
    const hidden = input.hidden.has(repoId)
    const workspaces: WorkspaceRow[] = []
    const projectItems: AttentionItem[] = []
    for (const w of rows) {
      const { row, item } = workspaceRow(w, w === main, merging)
      workspaces.push(row)
      if (item) projectItems.push({ ...item, projectId: repoId, projectName })
    }
    // Main first, then attention, then most recently active.
    workspaces.sort(
      (a, b) =>
        Number(b.isMain) - Number(a.isMain) ||
        b.attention.length - a.attention.length ||
        (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)
    )
    if (!hidden) attention.push(...projectItems)
    const active = workspaces.find((r) => r.isActive) ?? null
    const host = rows[0].env ?? null
    const ticketSource = host ? (localByName.get(projectName) ?? null) : repoId
    projects.push({
      id: repoId,
      name: projectName,
      host,
      ticketSource,
      mainWorktreeId: main?.worktreeId ?? null,
      mainPath: main?.path ?? null,
      isActive: active !== null,
      merging,
      activeWorkspace: active?.name ?? null,
      hidden,
      usesTickets: usesTickets(rows) || Boolean(ticketSource && input.tickets[ticketSource]),
      attentionCount: projectItems.length,
      runningAgents: workspaces.filter((r) => r.agentState === 'working').length,
      openPrs: workspaces.filter((r) => r.pr?.state === 'open').length,
      readyPrs: workspaces.filter((r) => r.pr?.state === 'open' && r.pr.checks === 'success').length,
      cleanupCount: workspaces.filter((r) => r.cleanable).length,
      lastActivityAt: Math.max(0, ...workspaces.map((r) => r.lastActivityAt ?? 0)),
      tickets: (ticketSource && input.tickets[ticketSource]) || null,
      ticketsLoading: ticketSource !== null && input.ticketsLoading.has(ticketSource),
      workspaces
    })
  }

  projects.sort(
    (a, b) =>
      Number(a.hidden) - Number(b.hidden) ||
      Number(b.attentionCount > 0) - Number(a.attentionCount > 0) ||
      b.lastActivityAt - a.lastActivityAt
  )
  // Urgent kinds first (a blocked agent beats a stale unread flag), then what waited longest.
  attention.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || (a.since ?? input.now) - (b.since ?? input.now))
  return { projects, attention, updatedAt: input.now, error: input.error ?? null, warnings: input.warnings ?? [] }
}

/** Finds the terminal handle for an agent pane: `paneKey` is `<tabId>:<leafId>`. */
export function handleForPane(
  paneKey: string | undefined,
  terminals: { handle: string; tabId?: string; leafId?: string }[]
): string | null {
  if (!paneKey) return null
  const [tabId, leafId] = paneKey.split(':')
  return terminals.find((t) => t.tabId === tabId && t.leafId === leafId)?.handle ?? null
}
