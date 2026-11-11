// The overview's worker: polls Orca's workspaces, keeps ticket counts, answers the panel and
// keeps the status bar item current. A save restarts it, so what must survive lives in storage.
import type { OrcaWorkerApi } from 'orca/worker'
import { markRead, openAgent, reply, runSkill, terminalsOf } from './actions.ts'
import { orcaJson, surveyAvailable, surveyTickets } from './cli.ts'
import { buildSnapshot, isMerging, keepOneActive, omittedHosts, tagRemote, type PsWorktree } from './model.ts'
import type { Snapshot, TicketCounts } from './protocol.ts'
import { failedSurvey, parseSurvey } from './survey.ts'

const POLL_MS = 15_000
const TICKETS_MS = 5 * 60_000
const DEBOUNCE_MS = 500
const SURVEY_CONCURRENCY = 2
const REMOTE_TIMEOUT_MS = 10_000
/** How long a click on Merge tickets counts as a merge in progress before Orca reports one. */
const PENDING_MERGE_MS = 2 * 60_000

const K_TICKETS = 'tickets'
const K_HIDDEN = 'hidden'
const K_NOTIFIED = 'notified'

export default function activate(orca: OrcaWorkerApi): void {
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
  /** Project id -> when /merge-tickets was started from the panel. */
  const pendingMerges = new Map<string, number>()
  /** The last decision between several hosts' active workspaces, keyed by what it was made from. */
  let activeChoice: { key: string; keep: string | null } | null = null
  let refreshing: Promise<Snapshot> | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null

  const loaded = (async () => {
    const t = await orca.storage.get(K_TICKETS)
    if (t && typeof t === 'object' && !Array.isArray(t)) tickets = t as unknown as Record<string, TicketCounts>
    const h = await orca.storage.get(K_HIDDEN)
    if (Array.isArray(h)) hidden = new Set(h.filter((x): x is string => typeof x === 'string'))
    const n = await orca.storage.get(K_NOTIFIED)
    if (Array.isArray(n)) notified = new Set(n.filter((x): x is string => typeof x === 'string'))
  })()

  /** Drops clicks Orca now reports as a running merge, and ones that never showed up. */
  function livePendingMerges(now: number): Set<string> {
    for (const [projectId, startedAt] of pendingMerges) {
      const mainId = snapshot?.projects.find((p) => p.id === projectId)?.mainWorktreeId
      const main = mainId ? (worktrees.find((w) => w.worktreeId === mainId) ?? null) : null
      if (now - startedAt > PENDING_MERGE_MS || isMerging(main)) pendingMerges.delete(projectId)
    }
    return new Set(pendingMerges.keys())
  }

  function rebuild(): Snapshot {
    const now = Date.now()
    snapshot = buildSnapshot({
      worktrees,
      tickets,
      ticketsLoading,
      hidden,
      pendingMerges: livePendingMerges(now),
      now,
      error: lastError,
      warnings
    })
    orca.panels.post('overview.snapshot', snapshot)
    void updateStatusBar(snapshot)
    return snapshot
  }

  async function updateStatusBar(s: Snapshot): Promise<void> {
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

  async function notifyNew(s: Snapshot): Promise<void> {
    const keys = new Set(s.attention.flatMap((a) => a.notifyKeys))
    // First run ever: remember what is already there instead of announcing all of it.
    if (notified) {
      // A workspace gaining a new reason notifies again, with only the new reasons.
      const fresh = s.attention
        .map((a) => ({ a, reasons: a.reasons.filter((_, i) => !notified!.has(a.notifyKeys[i])) }))
        .filter((f) => f.reasons.length > 0)
      for (const { a, reasons } of fresh.slice(0, 3)) {
        await orca.host
          .call('notifications.show', { title: `${a.projectName} · ${a.workspaceName}`, body: reasons.join(' · ').slice(0, 300) })
          .catch(() => undefined)
      }
      if (fresh.length > 3) {
        await orca.host
          .call('notifications.show', { title: 'Orca Overview', body: `${fresh.length - 3} more things need you.` })
          .catch(() => undefined)
      }
    }
    notified = keys
    await orca.storage.set(K_NOTIFIED, [...keys])
  }

  function refresh(): Promise<Snapshot> {
    if (refreshing) return refreshing
    refreshing = (async () => {
      await loaded
      try {
        worktrees = await readAllHosts()
        lastError = null
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        orca.log(`worktree ps failed: ${lastError}`)
      }
      const s = rebuild()
      if (!lastError) await notifyNew(s).catch((e) => orca.log(`notify failed: ${String(e)}`))
      scheduleStaleSurveys(s)
      return s
    })().finally(() => {
      refreshing = null
    })
    return refreshing
  }

  /** This machine's workspaces plus those of every paired server `ps` left out (e.g. devbox). */
  async function readAllHosts(): Promise<PsWorktree[]> {
    type Ps = { worktrees?: PsWorktree[]; hostScope?: { omittedHostSelectors?: { selector?: string; hostId?: string }[] } }
    const local = await orcaJson<Ps>(['worktree', 'ps'])
    const nextWarnings: string[] = []
    const remote = await Promise.all(
      omittedHosts(local.hostScope).map(async ({ env }) => {
        try {
          const r = await orcaJson<Ps>(['worktree', 'ps', '--environment', env], REMOTE_TIMEOUT_MS)
          return tagRemote(env, r.worktrees ?? [])
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
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
   * owning the focused workspace's terminals (readContext's terminal ids are CLI handles).
   */
  async function pickActive(rows: PsWorktree[]): Promise<PsWorktree[]> {
    const candidates = rows.filter((w) => w.isActive)
    if (candidates.length <= 1) return rows
    const ctx = await orca.host.call('workspace.readContext').catch(() => null)
    const ids = new Set((ctx?.terminals ?? []).map((t) => t.id))
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

  function refreshSoon(): void {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      void refresh()
    }, DEBOUNCE_MS)
  }

  // Ticket counts: survey.sh per project, at most two at a time, results kept in storage.
  function scheduleStaleSurveys(s: Snapshot): void {
    if (!surveyAvailable()) return
    const now = Date.now()
    for (const p of s.projects) {
      // A remote project is counted through its local checkout (its ticketSource).
      if (p.hidden || !p.usesTickets || !p.ticketSource) continue
      const fetchedAt = tickets[p.ticketSource]?.fetchedAt ?? 0
      if (now - fetchedAt >= TICKETS_MS) enqueueSurvey(p.ticketSource)
    }
  }

  function enqueueSurvey(projectId: string): void {
    if (ticketsLoading.has(projectId)) return
    ticketsLoading.add(projectId)
    surveyQueue.push(projectId)
    pumpSurveys()
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
    const project = snapshot?.projects.find((p) => p.id === projectId)
    if (!project?.mainPath) return
    try {
      tickets[projectId] = parseSurvey(await surveyTickets(project.mainPath), Date.now())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      orca.log(`survey ${project.name} failed: ${message}`)
      tickets[projectId] = failedSurvey(message, Date.now(), tickets[projectId] ?? null)
    }
    await orca.storage.set(K_TICKETS, tickets as unknown as Parameters<typeof orca.storage.set>[1])
  }

  function worktree(worktreeId: string): PsWorktree {
    const w = worktrees.find((x) => x.worktreeId === worktreeId)
    if (!w) throw new Error('That workspace is gone; refresh the overview.')
    return w
  }

  function mainOf(projectId: string): PsWorktree {
    const id = snapshot?.projects.find((p) => p.id === projectId)?.mainWorktreeId
    if (!id) throw new Error('This project has no main workspace in Orca.')
    return worktree(id)
  }

  orca.panels.handle('overview.snapshot', async () => snapshot ?? (await refresh()))
  orca.panels.handle('overview.refresh', () => refresh())
  orca.panels.handle('overview.refreshTickets', async ({ projectId }) => {
    if (!snapshot) await refresh()
    const project = snapshot?.projects.find((p) => p.id === projectId)
    // A remote project counts with its local checkout; survey.sh runs on this machine.
    if (!project?.ticketSource) throw new Error('Ticket counts need a local checkout of this repo in Orca.')
    enqueueSurvey(project.ticketSource)
    return rebuild()
  })
  orca.panels.handle('overview.runSkill', async ({ projectId, skill, args }) => {
    const result = await runSkill(orca, mainOf(projectId), skill, args)
    if (skill === 'merge-tickets') {
      pendingMerges.set(projectId, Date.now())
      rebuild()
    }
    refreshSoon()
    return result
  })
  orca.panels.handle('overview.open', async ({ worktreeId }) => {
    await openAgent(orca, worktree(worktreeId))
    return { ok: true as const }
  })
  orca.panels.handle('overview.reply', async ({ worktreeId, text }) => {
    const result = await reply(worktree(worktreeId), text)
    refreshSoon()
    return result
  })
  orca.panels.handle('overview.markRead', async ({ worktreeId }) => {
    await markRead(worktree(worktreeId))
    return refresh()
  })
  orca.panels.handle('overview.setHidden', async ({ projectId, hidden: hide }) => {
    await loaded
    if (hide) hidden.add(projectId)
    else hidden.delete(projectId)
    await orca.storage.set(K_HIDDEN, [...hidden])
    return rebuild()
  })

  orca.commands.register('overview.refresh', async () => {
    const s = await refresh()
    return `${s.attention.length} item(s) need you.`
  })
  orca.commands.register('overview.next', async () => {
    const s = snapshot ?? (await refresh())
    // Only local workspaces can be opened from here (see REMOTE_OPEN_UNSUPPORTED).
    const first = s.attention.find((a) => !s.projects.find((p) => p.id === a.projectId)?.host)
    if (!first) return s.attention.length ? 'Only workspaces on paired servers need you; open them from the sidebar.' : 'Nothing needs you.'
    await openAgent(orca, worktree(first.worktreeId))
    return `${first.projectName} · ${first.workspaceName}: ${first.reason}`
  })

  orca.events.on('agent.status.changed', refreshSoon)
  orca.events.on('workspace.changed', refreshSoon)
  orca.events.on('workspace.created', refreshSoon)
  orca.events.on('workspace.removed', refreshSoon)

  const timer = setInterval(() => void refresh(), POLL_MS)
  stop = () => {
    clearInterval(timer)
    if (debounce) clearTimeout(debounce)
  }
  void refresh()
}

let stop: (() => void) | null = null

export function deactivate(): void {
  stop?.()
  stop = null
}
