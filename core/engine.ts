// Keeps the overview current: polls every host, picks the active workspace, tracks merges started
// from the overview, schedules ticket surveys and announces what newly needs you. The plugin's
// worker and the desktop app both run it, each passing its own storage, notifications and opener.
import { orcaActions, type Opener, type OrcaJson } from './actions.ts'
import { orcaJson, surveyAvailable, surveyTickets } from './cli.ts'
import { buildSnapshot, findShown, isMerging, keepOneActive, omittedHosts, tagRemote, type HostWorktree, type PsWorktree } from './model.ts'
import { failedSurvey, parseSurvey } from './survey.ts'
import type { RunResult, Skill, Snapshot, TicketCounts } from './protocol.ts'

const REMOTE_TIMEOUT_MS = 10_000
const TICKETS_MS = 5 * 60_000
const SURVEY_CONCURRENCY = 2
const DEBOUNCE_MS = 500
/** How long a click on Merge tickets counts as a merge in progress before Orca reports one. */
const PENDING_MERGE_MS = 2 * 60_000

const K_TICKETS = 'tickets'
const K_HIDDEN = 'hidden'
const K_NOTIFIED = 'notified'

/** The `orca` CLI and the ticket survey; tests pass a fake. */
export interface EngineCli {
  orcaJson: OrcaJson
  surveyTickets(cwd: string): Promise<string>
  surveyAvailable(): boolean
}

export interface EngineDeps {
  /** Keeps values across restarts. */
  storage: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
  }
  /** Announces something new; `worktreeId` is the workspace it is about, absent for a summary. */
  notify(title: string, body: string, worktreeId?: string): Promise<void>
  /**
   * The CLI handles of the terminals in the workspace Orca shows. When several hosts report an
   * active workspace it picks the one Orca shows; without it, this machine's active one wins.
   */
  focusedTerminals?: () => Promise<string[]>
  /**
   * The workspace Orca shows, for apps outside Orca that can't read its terminals: the host as this
   * machine's `worktree ps` names it (`local`, or a paired server's `runtime:<id>` from hostScope)
   * and the worktree id as that host reports it. Checked before `focusedTerminals`.
   */
  focusedWorkspace?: () => Promise<HostWorktree | null>
  opener: Opener
  pollMs: number
  log?(message: string): void
  cli?: EngineCli
}

export type Engine = ReturnType<typeof createEngine>

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const realCli: EngineCli = { orcaJson, surveyTickets, surveyAvailable }

export function createEngine(deps: EngineDeps) {
  const cli = deps.cli ?? realCli
  const log = deps.log ?? (() => undefined)
  const { markRead, openAgent, reply, runSkill, terminalsOf } = orcaActions(cli.orcaJson)
  const listeners: ((s: Snapshot) => void)[] = []
  let worktrees: PsWorktree[] = []
  let tickets: Record<string, TicketCounts> = {}
  let hidden = new Set<string>()
  let notified: Set<string> | null = null
  const ticketsLoading = new Set<string>()
  const surveyQueue: string[] = []
  let surveyRunning = 0
  let snapshot: Snapshot | null = null
  let lastError: string | null = null
  let warnings: string[] = []
  /** Project id -> when /merge-tickets was started from the overview. */
  const pendingMerges = new Map<string, number>()
  /** The last decision between several hosts' active workspaces, keyed by what it was made from. */
  let activeChoice: { key: string; keep: string | null } | null = null
  let refreshing: Promise<Snapshot> | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  /** Set by stop(): events and actions still in flight then must not schedule a refresh. */
  let stopped = false

  const strings = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null)
  const loaded = (async () => {
    const t = await deps.storage.get(K_TICKETS)
    if (t && typeof t === 'object' && !Array.isArray(t)) tickets = t as Record<string, TicketCounts>
    const h = strings(await deps.storage.get(K_HIDDEN))
    if (h) hidden = new Set(h)
    const n = strings(await deps.storage.get(K_NOTIFIED))
    if (n) notified = new Set(n)
  })()

  const projectOf = (projectId: string) => snapshot?.projects.find((p) => p.id === projectId)

  /** Drops clicks Orca now reports as a running merge, and ones that never showed up. */
  function livePendingMerges(now: number): Set<string> {
    for (const [projectId, startedAt] of pendingMerges) {
      const mainId = projectOf(projectId)?.mainWorktreeId
      const main = mainId ? (worktrees.find((w) => w.worktreeId === mainId) ?? null) : null
      if (now - startedAt > PENDING_MERGE_MS || isMerging(main)) pendingMerges.delete(projectId)
    }
    return new Set(pendingMerges.keys())
  }

  function rebuild(): Snapshot {
    const now = Date.now()
    const s = buildSnapshot({
      worktrees,
      tickets,
      ticketsLoading,
      hidden,
      pendingMerges: livePendingMerges(now),
      now,
      error: lastError,
      warnings
    })
    snapshot = s
    for (const listener of listeners) listener(s)
    return s
  }

  async function notifyNew(s: Snapshot): Promise<void> {
    const keys = new Set(s.attention.flatMap((a) => a.notifyKeys))
    // First run ever: remember what is already there instead of announcing all of it.
    const known = notified
    if (known) {
      // A workspace gaining a new reason notifies again, with only the new reasons.
      const fresh = s.attention
        .map((a) => ({ a, reasons: a.reasons.filter((_, i) => !known.has(a.notifyKeys[i])) }))
        .filter((f) => f.reasons.length > 0)
      for (const { a, reasons } of fresh.slice(0, 3)) {
        await deps.notify(`${a.projectName} · ${a.workspaceName}`, reasons.join(' · ').slice(0, 300), a.worktreeId).catch(() => undefined)
      }
      if (fresh.length > 3) await deps.notify('Orca Overview', `${fresh.length - 3} more things need you.`).catch(() => undefined)
    }
    notified = keys
    await deps.storage.set(K_NOTIFIED, [...keys])
  }

  function refresh(): Promise<Snapshot> {
    if (refreshing) return refreshing
    refreshing = (async () => {
      await loaded
      try {
        worktrees = await readAllHosts()
        lastError = null
      } catch (error) {
        lastError = messageOf(error)
        log(`worktree ps failed: ${lastError}`)
      }
      const s = rebuild()
      if (!lastError) await notifyNew(s).catch((e) => log(`notify failed: ${messageOf(e)}`))
      // Show the queued surveys as loading now, not only when the first one ends.
      return scheduleStaleSurveys(s) ? rebuild() : s
    })().finally(() => {
      refreshing = null
    })
    return refreshing
  }

  /** This machine's workspaces plus those of every paired server `ps` left out (e.g. devbox). */
  async function readAllHosts(): Promise<PsWorktree[]> {
    type Ps = { worktrees?: PsWorktree[]; hostScope?: { omittedHostSelectors?: { selector?: string; hostId?: string }[] } }
    const local = await cli.orcaJson<Ps>(['worktree', 'ps'])
    const nextWarnings: string[] = []
    const remote = await Promise.all(
      omittedHosts(local.hostScope).map(async ({ env, hostId }) => {
        try {
          const r = await cli.orcaJson<Ps>(['worktree', 'ps', '--environment', env], REMOTE_TIMEOUT_MS)
          return tagRemote(env, r.worktrees ?? [], hostId)
        } catch (error) {
          const message = messageOf(error)
          nextWarnings.push(`${env}: ${message}`)
          return []
        }
      })
    )
    warnings = nextWarnings
    return pickActive([...(local.worktrees ?? []), ...remote.flat()])
  }

  /**
   * Each host reports its own last-focused workspace as active. Keep the one Orca shows: the one
   * `focusedWorkspace` names, else the one owning the focused workspace's terminals, else this
   * machine's.
   */
  async function pickActive(rows: PsWorktree[]): Promise<PsWorktree[]> {
    const candidates = rows.filter((w) => w.isActive)
    if (candidates.length <= 1) return rows
    const focused = deps.focusedWorkspace ? await deps.focusedWorkspace().catch(() => null) : null
    const shown = focused && findShown(candidates, focused)
    if (shown) return keepOneActive(rows, shown.worktreeId)
    const ids = new Set(deps.focusedTerminals ? await deps.focusedTerminals().catch(() => []) : [])
    const key = `${candidates.map((c) => c.worktreeId).join('|')}#${[...ids].sort().join(',')}`
    if (activeChoice?.key !== key) {
      let keep: string | null = null
      if (ids.size > 0) {
        for (const c of candidates) {
          const terms = await terminalsOf(c).catch(() => [])
          if (terms.some((t) => ids.has(t.handle))) {
            keep = c.worktreeId
            break
          }
        }
      }
      keep ??= candidates.find((c) => !c.env)?.worktreeId ?? null
      activeChoice = { key, keep }
    }
    return keepOneActive(rows, activeChoice.keep)
  }

  // Ticket counts: survey.sh per project, at most two at a time, results kept in storage.
  /** Queues the surveys that are due; true when it queued any. */
  function scheduleStaleSurveys(s: Snapshot): boolean {
    if (!cli.surveyAvailable()) return false
    const now = Date.now()
    let queued = false
    for (const p of s.projects) {
      // A remote project is counted through its local checkout (its ticketSource).
      if (p.hidden || !p.usesTickets || !p.ticketSource) continue
      const fetchedAt = tickets[p.ticketSource]?.fetchedAt ?? 0
      if (now - fetchedAt >= TICKETS_MS && enqueueSurvey(p.ticketSource)) queued = true
    }
    return queued
  }

  /** Queues a survey unless one is queued or running; true when it queued it. */
  function enqueueSurvey(projectId: string): boolean {
    if (ticketsLoading.has(projectId)) return false
    ticketsLoading.add(projectId)
    surveyQueue.push(projectId)
    pumpSurveys()
    return true
  }

  function pumpSurveys(): void {
    while (surveyRunning < SURVEY_CONCURRENCY && surveyQueue.length > 0) {
      const id = surveyQueue.shift()!
      surveyRunning += 1
      void runSurvey(id).finally(() => {
        surveyRunning -= 1
        ticketsLoading.delete(id)
        rebuild()
        pumpSurveys()
      })
    }
  }

  async function runSurvey(projectId: string): Promise<void> {
    const project = projectOf(projectId)
    if (!project?.mainPath) return
    try {
      tickets[projectId] = parseSurvey(await cli.surveyTickets(project.mainPath), Date.now())
    } catch (error) {
      const message = messageOf(error)
      log(`survey ${project.name} failed: ${message}`)
      tickets[projectId] = failedSurvey(message, Date.now(), tickets[projectId] ?? null)
    }
    await deps.storage.set(K_TICKETS, tickets)
  }

  function worktree(worktreeId: string): PsWorktree {
    const w = worktrees.find((x) => x.worktreeId === worktreeId)
    if (!w) throw new Error('That workspace is gone; refresh the overview.')
    return w
  }

  function mainOf(projectId: string): PsWorktree {
    const id = projectOf(projectId)?.mainWorktreeId
    if (!id) throw new Error('This project has no main workspace in Orca.')
    return worktree(id)
  }

  /** Refreshes shortly, once for a burst of calls (e.g. Orca events). */
  function refreshSoon(): void {
    if (stopped) return
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      void refresh()
    }, DEBOUNCE_MS)
  }

  return {
    /** The last snapshot, or null before the first refresh. */
    snapshot: (): Snapshot | null => snapshot,
    /** Hears every new snapshot. */
    onSnapshot(listener: (s: Snapshot) => void): void {
      listeners.push(listener)
    },
    refresh,
    refreshSoon,
    /** Starts polling every `pollMs`, with a refresh right away. */
    start(): void {
      if (timer) return
      stopped = false
      timer = setInterval(() => void refresh(), deps.pollMs)
      void refresh()
    },
    stop(): void {
      stopped = true
      if (timer) clearInterval(timer)
      timer = null
      if (debounce) clearTimeout(debounce)
      debounce = null
    },
    async refreshTickets(projectId: string): Promise<Snapshot> {
      if (!snapshot) await refresh()
      const project = projectOf(projectId)
      // A remote project counts with its local checkout; survey.sh runs on this machine.
      if (!project?.ticketSource) throw new Error('Ticket counts need a local checkout of this repo in Orca.')
      enqueueSurvey(project.ticketSource)
      return rebuild()
    },
    async runSkill(projectId: string, skill: Skill, args?: string): Promise<RunResult> {
      const result = await runSkill(deps.opener, mainOf(projectId), skill, args)
      if (skill === 'merge-tickets') {
        pendingMerges.set(projectId, Date.now())
        rebuild()
      }
      refreshSoon()
      return result
    },
    async open(worktreeId: string): Promise<void> {
      await openAgent(deps.opener, worktree(worktreeId))
    },
    /** Opens the oldest local item that needs you; says what it did. */
    async openNext(): Promise<string> {
      const s = snapshot ?? (await refresh())
      // Only local workspaces can be opened from here (see REMOTE_OPEN_UNSUPPORTED).
      const first = s.attention.find((a) => !s.projects.find((p) => p.id === a.projectId)?.host)
      if (!first) return s.attention.length ? 'Only workspaces on paired servers need you; open them from the sidebar.' : 'Nothing needs you.'
      await openAgent(deps.opener, worktree(first.worktreeId))
      return `${first.projectName} · ${first.workspaceName}: ${first.reason}`
    },
    async reply(worktreeId: string, text: string): Promise<RunResult> {
      const result = await reply(worktree(worktreeId), text)
      refreshSoon()
      return result
    },
    async markRead(worktreeId: string): Promise<Snapshot> {
      await markRead(worktree(worktreeId))
      return refresh()
    },
    async setHidden(projectId: string, hide: boolean): Promise<Snapshot> {
      await loaded
      if (hide) hidden.add(projectId)
      else hidden.delete(projectId)
      await deps.storage.set(K_HIDDEN, [...hidden])
      return rebuild()
    }
  }
}
