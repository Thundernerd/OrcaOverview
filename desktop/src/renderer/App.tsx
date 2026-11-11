// The desktop window: the same overview as the plugin's panel (src/panel.tsx), drawn with React.
// All data comes from the main process through `api` (the preload's window.overview).
import { useEffect, useId, useRef, useState } from 'react'
import type { AttentionItem, AttentionKind, Project, RunResult, Skill, Snapshot } from '../../../core/protocol.ts'
import { KIND, MERGING_TIP, prCell, visibleProjects } from '../../../core/present.ts'
import type { OverviewApi } from '../preload/api.ts'
import { useView, type View } from './view.ts'

type Tone = 'danger' | 'warning' | 'success' | 'accent' | 'neutral'

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

/** The same limit as the panel: Orca cannot show a paired server's workspace from outside it. */
const REMOTE_TIP = 'Orca cannot open a paired server’s workspace from here yet. Use the sidebar.'

/** What the cards can do; each runs one request at a time through `act`. */
interface Actions {
  busy: boolean
  /** The one open input: `reply:<attention key>` or `write:<project id>`, or null. */
  editing: string | null
  setEditing(key: string | null): void
  refresh(): void
  open(worktreeId: string): void
  /** Resolves to whether it worked. */
  reply(worktreeId: string, text: string): Promise<boolean>
  markRead(worktreeId: string): void
  /** Resolves to whether it worked. */
  runSkill(p: Project, skill: Skill, args?: string): Promise<boolean>
  setHidden(projectId: string, hidden: boolean): void
  refreshTickets(projectId: string): void
}

/** How long ago `at` was, short: "now", "45s", "3m", "2h", "4d". */
function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 5) return 'now'
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86_400)}d`
}

/** The current time, updated every few seconds so relative times stay right. */
function useNow(everyMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(timer)
  }, [everyMs])
  return now
}

function RelativeTime({ at }: { at: number }) {
  const now = useNow()
  const text = ago(at, now)
  return <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>{text === 'now' ? 'just now' : `${text} ago`}</time>
}

function TicketLine({ p }: { p: Project }) {
  const t = p.tickets
  if (p.ticketsLoading && !t) return <p className="muted small">Counting tickets…</p>
  if (!t) return p.usesTickets ? <p className="muted small">Tickets not counted yet</p> : null
  return (
    <div className="row">
      <p className="muted small">
        Tickets: {t.ready} ready · {t.blocked} blocked · {t.launched} launched · {t.claimed + t.owned} taken · <RelativeTime at={t.fetchedAt} />
        {p.ticketsLoading ? ' · refreshing…' : ''}
      </p>
      {t.error ? <Badge tone="danger">survey failed</Badge> : null}
    </div>
  )
}

/** A one-line input that sends its trimmed text on Enter. It keeps the text when sending fails (`onSend` resolves to false). */
function Prompt({ label, placeholder, onSend }: { label: string; placeholder: string; onSend(text: string): Promise<boolean> | void }) {
  const [text, setText] = useState('')
  return (
    <form
      className="prompt"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!text.trim()) return
        if ((await onSend(text.trim())) !== false) setText('')
      }}
    >
      <input aria-label={label} placeholder={placeholder} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
    </form>
  )
}

function Button({ children, disabled, title, label, onClick, variant = 'outline' }: {
  children: React.ReactNode
  disabled?: boolean
  title?: string
  /** The accessible name of a button that shows only an icon; also its tooltip. */
  label?: string
  onClick(): void
  variant?: 'solid' | 'outline' | 'ghost'
}) {
  return (
    <button type="button" className={variant} disabled={disabled} title={title ?? label} aria-label={label} onClick={onClick}>
      {children}
    </button>
  )
}

/** A notification click that asked to show a workspace's card. `n` counts clicks, so clicking the same one again shows it again. */
type Reveal = { worktreeId: string; n: number }

/** How long a revealed card stays highlighted: the length of the `reveal` animation in styles.css. */
const REVEAL_MS = 2_000

function AttentionCard({ item, project, actions, revealed }: {
  item: AttentionItem
  project: Project | undefined
  actions: Actions
  /** Set (to the click's `n`) while a notification click shows this card. */
  revealed?: number
}) {
  const ref = useRef<HTMLElement>(null)
  const headingId = useId()
  useEffect(() => {
    const el = ref.current
    if (!revealed || !el) return
    // A second click while the card is still highlighted keeps its class, so play the fade again.
    // jsdom has neither getAnimations nor scrollIntoView.
    for (const a of el.getAnimations?.() ?? []) {
      a.currentTime = 0
      a.play()
    }
    el.scrollIntoView?.({ block: 'nearest' })
    el.focus({ preventScroll: true })
  }, [revealed])
  const replying = actions.editing === `reply:${item.key}`
  const has = (k: AttentionKind) => item.kinds.includes(k)
  const remote = Boolean(project?.host)
  const tip = remote ? REMOTE_TIP : undefined
  return (
    <article
      ref={ref}
      tabIndex={-1}
      aria-labelledby={headingId}
      className={`card attention ${KIND[item.kind].tone}${revealed ? ' revealed' : ''}`}
      style={revealed ? { animationDuration: `${REVEAL_MS}ms` } : undefined}
    >
      {/* Kind and age on their own line, so a long workspace name can never push them out. */}
      <div className="row between">
        <div className="row">
          {project?.host ? <Badge tone="neutral">{`☁ ${project.host}`}</Badge> : null}
          {item.kinds.map((k) => (
            <Badge key={k} tone={KIND[k].tone}>
              {KIND[k].label}
            </Badge>
          ))}
        </div>
        {item.since ? (
          <span className="muted small">
            <RelativeTime at={item.since} />
          </span>
        ) : null}
      </div>
      <h3 id={headingId} title={`${item.projectName} · ${item.workspaceName}`}>
        {item.projectName} · {item.workspaceName}
      </h3>
      {item.reasons.map((r) => (
        <p key={r} className="muted reason">
          {r}
        </p>
      ))}
      <div className="row">
        <Button variant="solid" disabled={actions.busy || remote} title={tip} onClick={() => actions.open(item.worktreeId)}>
          Open
        </Button>
        {project?.mainWorktreeId && project.mainWorktreeId !== item.worktreeId ? (
          <Button disabled={actions.busy || remote} title={tip} onClick={() => actions.open(project.mainWorktreeId!)}>
            Open main
          </Button>
        ) : null}
        {has('agent-waiting') ? (
          <Button disabled={actions.busy} onClick={() => actions.setEditing(replying ? null : `reply:${item.key}`)}>
            Reply
          </Button>
        ) : null}
        {has('flagged') ? (
          <Button disabled={actions.busy} onClick={() => actions.markRead(item.worktreeId)}>
            Mark read
          </Button>
        ) : null}
        {(has('pr-ready') || has('ci-failing')) && project ? (
          <Button disabled={actions.busy || project.merging} title={project.merging ? MERGING_TIP : undefined} onClick={() => actions.runSkill(project, 'merge-tickets')}>
            {project.merging ? 'Merging…' : 'Merge tickets'}
          </Button>
        ) : null}
      </div>
      {replying ? (
        <Prompt
          label={`Reply to the agent in ${item.workspaceName}`}
          placeholder="Type a reply and press Enter"
          onSend={async (text) => {
            const ok = await actions.reply(item.worktreeId, text)
            if (ok) actions.setEditing(null)
            return ok
          }}
        />
      ) : null}
    </article>
  )
}

function WorkspaceTable({ p, actions }: { p: Project; actions: Actions }) {
  return (
    <table aria-label={`${p.name} workspaces`}>
      <thead>
        <tr>
          <th>Workspace</th>
          <th>Agent</th>
          <th className="wide">PR</th>
          <th className="wide">Status</th>
          <th className="wide">Active</th>
        </tr>
      </thead>
      <tbody>
        {p.workspaces.map((w) => {
          const name = `${w.isActive ? '▶ ' : ''}${w.attention.length ? '● ' : ''}${w.isMain ? '★ ' : ''}${w.name}`
          return (
            <tr key={w.worktreeId} className={w.isActive ? 'active' : undefined}>
              <td className="name">
                {p.host ? (
                  name
                ) : (
                  <button type="button" className="link" aria-label={`Open workspace ${w.name}`} title={`Open workspace ${w.name}`} disabled={actions.busy} onClick={() => actions.open(w.worktreeId)}>
                    {name}
                  </button>
                )}
              </td>
              <td>{w.agentState ?? '-'}</td>
              <td className="wide">{prCell(w)}</td>
              <td className="wide">{w.cleanable ? 'clean up' : (w.status ?? '-')}</td>
              <td className="wide muted">{w.lastActivityAt ? <RelativeTime at={w.lastActivityAt} /> : null}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ProjectCard({ p, view, actions }: { p: Project; view: View; actions: Actions }) {
  const isMin = view.state.minimized[p.id] === true
  const isPinned = view.state.pinned[p.id] === true
  const isOpen = view.state.expanded[p.id] ?? p.attentionCount > 0
  const disabled = actions.busy || !p.mainWorktreeId
  const ready = p.tickets?.ready ?? 0
  const writing = actions.editing === `write:${p.id}`
  return (
    <article aria-label={p.name} className={`card project${p.isActive ? ' active' : ''}`}>
      <div className="row between">
        <div className="row">
          <Button variant="ghost" label={isMin ? `Expand ${p.name}` : `Minimize ${p.name}`} onClick={() => view.toggle('minimized', p.id)}>
            {isMin ? '▸' : '▾'}
          </Button>
          <h3>{p.name}</h3>
          {p.host ? <Badge tone="neutral">{`☁ ${p.host}`}</Badge> : null}
          {p.isActive ? <Badge tone="accent">Active</Badge> : null}
          <Button
            variant="ghost"
            disabled={disabled || p.host !== null}
            title={p.host ? REMOTE_TIP : undefined}
            onClick={() => actions.open(p.mainWorktreeId!)}
          >
            Open main
          </Button>
        </div>
        <div className="row">
          <Button variant={isPinned ? 'solid' : 'ghost'} label={isPinned ? `Unpin ${p.name}` : `Pin ${p.name}`} onClick={() => view.toggle('pinned', p.id)}>
            ★
          </Button>
          <Button
            variant="ghost"
            label={p.tickets ? 'Recount tickets' : 'Count tickets'}
            disabled={p.ticketsLoading || !p.ticketSource}
            onClick={() => actions.refreshTickets(p.id)}
          >
            ↻
          </Button>
          <Button variant="ghost" label={`Hide ${p.name}`} onClick={() => actions.setHidden(p.id, true)}>
            ×
          </Button>
        </div>
      </div>
      <div className="row">
        {p.isActive && p.activeWorkspace && !p.workspaces.find((w) => w.isActive)?.isMain ? <Badge tone="accent">{`▶ ${p.activeWorkspace}`}</Badge> : null}
        {p.attentionCount > 0 ? <Badge tone="warning">{p.attentionCount} need you</Badge> : <Badge tone="neutral">quiet</Badge>}
        {p.merging ? <Badge tone="accent">Merging…</Badge> : null}
        {p.runningAgents > 0 ? <Badge tone="accent">{p.runningAgents} working</Badge> : null}
        {p.openPrs > 0 ? <Badge tone="neutral">{p.openPrs} PR open</Badge> : null}
        {ready > 0 ? <Badge tone="success">{ready} ready to launch</Badge> : null}
        {p.cleanupCount > 0 ? <Badge tone="neutral">{p.cleanupCount} to clean</Badge> : null}
      </div>
      {isMin ? null : (
        <>
          <TicketLine p={p} />
          <div className="row">
            <Button variant={ready > 0 ? 'solid' : 'outline'} disabled={disabled} onClick={() => actions.runSkill(p, 'launch-tickets')}>
              Launch tickets
            </Button>
            <Button
              variant={p.readyPrs > 0 && !p.merging ? 'solid' : 'outline'}
              disabled={disabled || p.merging}
              title={p.merging ? MERGING_TIP : undefined}
              onClick={() => actions.runSkill(p, 'merge-tickets')}
            >
              {p.merging ? 'Merging…' : 'Merge tickets'}
            </Button>
            <Button variant={p.cleanupCount > 0 ? 'solid' : 'outline'} disabled={disabled} onClick={() => actions.runSkill(p, 'clean-workspaces')}>
              Clean workspaces
            </Button>
            <Button disabled={disabled} onClick={() => actions.setEditing(writing ? null : `write:${p.id}`)}>
              Write ticket
            </Button>
          </div>
          {writing ? (
            <Prompt
              label={`Describe the new ticket for ${p.name}`}
              placeholder="Describe the ticket, then press Enter"
              onSend={async (text) => {
                const ok = await actions.runSkill(p, 'write-ticket', text)
                if (ok) actions.setEditing(null)
                return ok
              }}
            />
          ) : null}
          <details open={isOpen}>
            <summary
              onClick={(e) => {
                e.preventDefault()
                view.setExpanded(p.id, !isOpen)
              }}
            >
              Workspaces ({p.workspaces.length})
            </summary>
            <div className="table-scroll">
              <WorkspaceTable p={p} actions={actions} />
            </div>
          </details>
        </>
      )}
    </article>
  )
}

type Notice = { tone: 'success' | 'danger'; text: string }

/** What the last action did, or why it failed. */
function NoticeCallout({ notice, onDismiss }: { notice: Notice; onDismiss(): void }) {
  return (
    <div role={notice.tone === 'danger' ? 'alert' : 'status'} className={`callout ${notice.tone}`}>
      <strong>{notice.tone === 'danger' ? 'That did not work' : 'Done'}</strong>
      <span>{notice.text}</span>
      <Button variant="ghost" label="Dismiss" onClick={onDismiss}>
        ×
      </Button>
    </div>
  )
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function App({ api }: { api: OverviewApi }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const running = useRef(false)
  const [editing, setEditing] = useState<string | null>(null)
  const view = useView(api)
  // A notification click waits in `asked` for a snapshot, then shows its card while `shown` is set.
  const clicks = useRef(0)
  const [asked, setAsked] = useState<Reveal | null>(null)
  const [shown, setShown] = useState<Reveal | null>(null)
  useEffect(() => api.onReveal((worktreeId) => setAsked({ worktreeId, n: ++clicks.current })), [api])
  useEffect(() => {
    if (!asked || !snapshot) return
    // A workspace that no longer needs you (marked read in between) leaves the window as it is.
    if (snapshot.attention.some((a) => a.worktreeId === asked.worktreeId)) setShown(asked)
    setAsked(null)
  }, [asked, snapshot])
  useEffect(() => {
    if (!shown) return
    const timer = setTimeout(() => setShown(null), REVEAL_MS)
    return () => clearTimeout(timer)
  }, [shown])
  useEffect(() => {
    api
      .request('overview.snapshot')
      .then(setSnapshot)
      .catch((e: unknown) => setNotice({ tone: 'danger', text: message(e) }))
    return api.onSnapshot(setSnapshot)
  }, [api])

  /** Runs one action at a time, showing what happened. */
  async function act(label: string, fn: () => Promise<unknown>, done?: (result: unknown) => string | null): Promise<boolean> {
    if (running.current) return false
    running.current = true
    setBusy(label)
    setNotice(null)
    try {
      const result = await fn()
      const text = done?.(result)
      if (text) setNotice({ tone: 'success', text })
      return true
    } catch (e) {
      setNotice({ tone: 'danger', text: `${label}: ${message(e)}` })
      return false
    } finally {
      running.current = false
      setBusy(null)
    }
  }
  const said = (r: unknown) => (r as RunResult).message

  const actions: Actions = {
    busy: busy !== null,
    editing,
    setEditing,
    refresh: () => void act('Refresh', async () => setSnapshot(await api.request('overview.refresh'))),
    open: (worktreeId) => void act('Open', () => api.request('overview.open', { worktreeId })),
    reply: (worktreeId, text) => act('Reply', () => api.request('overview.reply', { worktreeId, text }), said),
    markRead: (worktreeId) => void act('Mark read', async () => setSnapshot(await api.request('overview.markRead', { worktreeId }))),
    runSkill: (p, skill, args) =>
      act(`/${skill}`, () => api.request('overview.runSkill', args ? { projectId: p.id, skill, args } : { projectId: p.id, skill }), said),
    setHidden: (projectId, hidden) =>
      void act(hidden ? 'Hide' : 'Show', async () => setSnapshot(await api.request('overview.setHidden', { projectId, hidden }))),
    refreshTickets: (projectId) => void act('Tickets', async () => setSnapshot(await api.request('overview.refreshTickets', { projectId })))
  }

  const callout = notice ? <NoticeCallout notice={notice} onDismiss={() => setNotice(null)} /> : null
  if (!snapshot) {
    return (
      <main>
        {callout}
        <p className="muted">Reading your workspaces…</p>
      </main>
    )
  }
  const byId = new Map(snapshot.projects.map((p) => [p.id, p]))
  const visible = visibleProjects(snapshot.projects, view.state.pinned)
  const hidden = snapshot.projects.filter((p) => p.hidden)
  const activeProject = snapshot.projects.find((p) => p.isActive) ?? null
  return (
    <main>
      <header>
        <div className="row between">
          <div className="row">
            <h1>Overview</h1>
            <Badge tone={snapshot.attention.length ? 'warning' : 'success'}>
              {snapshot.attention.length ? `${snapshot.attention.length} need you` : 'all clear'}
            </Badge>
          </div>
          <div className="row">
            {busy ? <span className="muted small">{busy}…</span> : <span className="muted small"><RelativeTime at={snapshot.updatedAt} /></span>}
            <Button variant="ghost" label="Refresh" disabled={busy !== null} onClick={actions.refresh}>
              ↻
            </Button>
          </div>
        </div>
        {activeProject ? (
          <p className="small">
            <span className="muted">Active: </span>
            <strong className="accent">
              {activeProject.name}
              {activeProject.activeWorkspace ? ` · ${activeProject.activeWorkspace}` : ''}
            </strong>
          </p>
        ) : null}
      </header>
      {/* Grouped so that, in the wide layout, a pile of notices scrolls instead of squeezing both columns. */}
      <div className="notices">
        {snapshot.warnings.map((w) => (
          <div key={w} role="status" className="callout warning">
            <strong>A paired server could not be read</strong>
            <span>{w}</span>
          </div>
        ))}
        {snapshot.error ? (
          <div role="alert" className="callout danger">
            <strong>Could not read Orca’s workspaces</strong>
            <span>{snapshot.error}</span>
          </div>
        ) : null}
        {callout}
      </div>
      {/* Needs you comes first, so a narrow window stacks it above the projects; a wide one puts it on the right. */}
      <div className="columns">
        <aside aria-labelledby="needs-you" className="needs-you">
          {/* The column is named "Needs you"; its heading also shows the count. */}
          <h2>
            <span id="needs-you">Needs you</span> <span className="count">{snapshot.attention.length}</span>
          </h2>
          <div className="scroll">
            {snapshot.attention.length === 0 ? <p className="muted">Nothing is waiting on you.</p> : null}
            {snapshot.attention.map((item) => (
              <AttentionCard
                key={item.key}
                item={item}
                project={byId.get(item.projectId)}
                actions={actions}
                revealed={shown?.worktreeId === item.worktreeId ? shown.n : undefined}
              />
            ))}
          </div>
        </aside>
        <section aria-labelledby="projects" className="projects">
          <h2 id="projects">Projects</h2>
          <div className="scroll">
            {visible.length === 0 ? (
              <p className="muted">Orca has no workspaces to show.</p>
            ) : (
              <ul className="project-grid" aria-label="Project cards">
                {visible.map((p) => (
                  <li key={p.id}>
                    <ProjectCard p={p} view={view} actions={actions} />
                  </li>
                ))}
              </ul>
            )}
            {hidden.length > 0 ? (
              <details aria-label={`Hidden projects (${hidden.length})`}>
                <summary>Hidden projects ({hidden.length})</summary>
                {hidden.map((p) => (
                  <div key={p.id} className="row between">
                    <span>
                      {p.name}
                      {p.attentionCount ? ` · ${p.attentionCount} flagged` : ''}
                    </span>
                    <Button variant="ghost" label={`Show ${p.name}`} onClick={() => actions.setHidden(p.id, false)}>
                      Show
                    </Button>
                  </div>
                ))}
              </details>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  )
}
