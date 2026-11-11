// The overview panel. All data comes from the worker (src/worker.ts); this file only draws it.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Collapsible,
  EmptyState,
  Heading,
  IconButton,
  Input,
  plugin,
  read,
  RelativeTime,
  Row,
  set,
  Stack,
  Table,
  Text,
  update,
  type PanelContext,
  type TableRow,
  type Tone
} from 'orca'
import type { AttentionItem, AttentionKind, Project, Skill, Snapshot, WorkspaceRow } from './protocol.ts'

const snapshot = atom<Snapshot | null>(null)
const busy = atom<string | null>(null)
const notice = atom<{ tone: Tone; text: string } | null>(null)
const replyTo = atom<string | null>(null)
const writeFor = atom<string | null>(null)
const draft = atom('draft', '')
const showAll = atom('showAll', false)
const ATTENTION_LIMIT = 6
/** Workspace tables the person opened or closed, by project id. */
const expanded = atom<Record<string, boolean>>('expanded', {}, { persist: 'plugin' })
/** Project cards folded down to their header, by project id. */
const minimized = atom<Record<string, boolean>>('minimized', {}, { persist: 'plugin' })
/** Projects kept at the top of the list, by project id. */
const pinned = atom<Record<string, boolean>>('pinned', {}, { persist: 'plugin' })

const toggle = (a: typeof minimized, id: string) => update(a, (m) => ({ ...m, [id]: !m[id] }))

/** Orca 1.4.253 cannot show a paired server's workspace on this Mac from a plugin (see actions.ts). */
const REMOTE_TIP = 'Orca cannot open a paired server’s workspace from a plugin yet. Use the sidebar.'

const MERGING_TIP = '/merge-tickets is already running in this project’s main workspace.'

const KIND: Record<AttentionKind, { label: string; tone: Tone }> = {
  'agent-waiting': { label: 'Agent waiting', tone: 'danger' },
  flagged: { label: 'Flagged', tone: 'warning' },
  'ci-failing': { label: 'CI failing', tone: 'danger' },
  'pr-ready': { label: 'Ready to merge', tone: 'success' }
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('overview.snapshot', (s) => set(snapshot, s)))
  void plugin
    .request('overview.snapshot', undefined, { timeoutMs: 60_000 })
    .then((s) => set(snapshot, s))
    .catch((e) => set(notice, { tone: 'danger', text: message(e) }))
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Runs one action at a time, showing what happened. */
async function act(label: string, fn: () => Promise<unknown>, done?: (result: unknown) => string | null): Promise<void> {
  if (read(busy)) return
  set(busy, label)
  set(notice, null)
  try {
    const result = await fn()
    const text = done?.(result)
    if (text) set(notice, { tone: 'success', text })
  } catch (e) {
    set(notice, { tone: 'danger', text: `${label}: ${message(e)}` })
  } finally {
    set(busy, null)
  }
}

const refresh = () => act('Refresh', async () => set(snapshot, await plugin.request('overview.refresh', undefined, { timeoutMs: 60_000 })))
const open = (worktreeId: string) => act('Open', () => plugin.request('overview.open', { worktreeId }))
const runSkill = (p: Project, skill: Skill, args?: string) =>
  act(
    `/${skill}`,
    () => plugin.request('overview.runSkill', args ? { projectId: p.id, skill, args } : { projectId: p.id, skill }, { timeoutMs: 90_000 }),
    (r) => (r as { message: string }).message
  )
const sendReply = (worktreeId: string, text: string) =>
  act(
    'Reply',
    async () => {
      const r = await plugin.request('overview.reply', { worktreeId, text }, { timeoutMs: 60_000 })
      set(replyTo, null)
      set(draft, '')
      return r
    },
    (r) => (r as { message: string }).message
  )
const markRead = (worktreeId: string) =>
  act('Mark read', async () => set(snapshot, await plugin.request('overview.markRead', { worktreeId })))
const setHidden = (projectId: string, hidden: boolean) =>
  act(hidden ? 'Hide' : 'Show', async () => set(snapshot, await plugin.request('overview.setHidden', { projectId, hidden })))
const refreshTickets = (projectId: string) =>
  act('Tickets', async () => set(snapshot, await plugin.request('overview.refreshTickets', { projectId })))

function AttentionCard({ item, project }: { item: AttentionItem; project: Project | undefined }) {
  const kind = KIND[item.kind]
  const has = (k: AttentionKind) => item.kinds.includes(k)
  const remote = Boolean(project?.host)
  const replying = read(replyTo) === item.key
  const disabled = read(busy) !== null
  return (
    <Box border={kind.tone} radius="md" padding="sm" gap="xs" direction="column">
      {/* Kind and age on their own line, so a long workspace name can never push them out. */}
      <Row justify="between" gap="xs">
        <Row gap="xs" wrap>
          {project?.host ? <Badge tone="neutral">{`☁ ${project.host}`}</Badge> : null}
          {item.kinds.map((k) => (
            <Badge tone={KIND[k].tone}>{KIND[k].label}</Badge>
          ))}
        </Row>
        {item.since ? (
          <Text size="xs" muted>
            <RelativeTime at={item.since} format="short" muted />
          </Text>
        ) : null}
      </Row>
      <Text weight="semibold" truncate>
        {item.projectName} · {item.workspaceName}
      </Text>
      {item.reasons.map((r) => (
        <Text size="sm" muted>
          {r}
        </Text>
      ))}
      <Row gap="xs" wrap>
        <Button size="xs" icon="open-external" disabled={disabled || remote} tooltip={remote ? REMOTE_TIP : undefined} onPress={() => open(item.worktreeId)}>
          Open
        </Button>
        {project?.mainWorktreeId && project.mainWorktreeId !== item.worktreeId ? (
          <Button size="xs" icon="open-external" variant="outline" disabled={disabled || remote} tooltip={remote ? REMOTE_TIP : undefined} onPress={() => open(project.mainWorktreeId!)}>
            Open main
          </Button>
        ) : null}
        {has('agent-waiting') ? (
          <Button size="xs" icon="edit" variant="outline" disabled={disabled} onPress={() => set(replyTo, replying ? null : item.key)}>
            Reply
          </Button>
        ) : null}
        {has('flagged') ? (
          <Button size="xs" icon="check" variant="outline" disabled={disabled} onPress={() => markRead(item.worktreeId)}>
            Mark read
          </Button>
        ) : null}
        {(has('pr-ready') || has('ci-failing')) && project ? (
          <Button
            size="xs"
            icon="branch"
            variant="outline"
            disabled={disabled || project.merging}
            tooltip={project.merging ? MERGING_TIP : undefined}
            onPress={() => runSkill(project, 'merge-tickets')}
          >
            {project.merging ? 'Merging…' : 'Merge tickets'}
          </Button>
        ) : null}
      </Row>
      {replying ? (
        <Input
          label={`Reply to the agent in ${item.workspaceName}`}
          labelHidden
          placeholder="Type a reply and press Enter"
          value={read(draft)}
          onChange={(v) => set(draft, v)}
          onSubmit={(v) => (v.trim() ? sendReply(item.worktreeId, v.trim()) : undefined)}
        />
      ) : null}
    </Box>
  )
}

function agentCell(w: WorkspaceRow): string {
  if (!w.agentState) return '-'
  return w.agentState
}

function prCell(w: WorkspaceRow): string {
  if (!w.pr) return w.issue ? `#${w.issue}` : '-'
  const checks = w.pr.checks === 'success' ? '✓' : w.pr.checks === 'failure' ? '✗' : w.pr.checks === 'pending' ? '…' : ''
  return `PR ${w.pr.number} ${w.pr.state}${checks ? ` ${checks}` : ''}`
}

function workspaceRows(p: Project): TableRow[] {
  return p.workspaces.map((w) => ({
    key: w.worktreeId,
    cells: {
      name: `${w.isActive ? '▶ ' : ''}${w.attention.length ? '● ' : ''}${w.isMain ? '★ ' : ''}${w.name}`,
      agent: agentCell(w),
      pr: prCell(w),
      status: w.cleanable ? 'clean up' : w.status ?? '-',
      activity: w.lastActivityAt ? { type: 'relative', at: w.lastActivityAt, format: 'short' } : null
    }
  }))
}

function ticketLine(p: Project) {
  const t = p.tickets
  if (p.ticketsLoading && !t) return <Text size="xs" muted>Counting tickets…</Text>
  if (!t) return p.usesTickets ? <Text size="xs" muted>Tickets not counted yet</Text> : null
  return (
    <Row gap="xs" wrap>
      <Text size="xs" muted>
        Tickets: {t.ready} ready · {t.blocked} blocked · {t.launched} launched · {t.claimed + t.owned} taken ·{' '}
        <RelativeTime at={t.fetchedAt} format="short" muted />
        {p.ticketsLoading ? ' · refreshing…' : ''}
      </Text>
      {t.error ? <Badge tone="danger">survey failed</Badge> : null}
    </Row>
  )
}

function ProjectCard({ p }: { p: Project }) {
  const disabled = read(busy) !== null || !p.mainWorktreeId
  const isOpen = read(expanded)[p.id] ?? p.attentionCount > 0
  const isMin = read(minimized)[p.id] === true
  const isPinned = read(pinned)[p.id] === true
  const writing = read(writeFor) === p.id
  const ready = p.tickets?.ready ?? 0
  return (
    <Box border={p.isActive ? 'accent' : true} radius="md" padding="sm" gap="sm" direction="column" background="card">
      <Row justify="between" gap="xs">
        <Row gap="xs">
          <IconButton
            icon={isMin ? 'expand' : 'collapse'}
            label={isMin ? `Expand ${p.name}` : `Minimize ${p.name}`}
            size="xs"
            variant="ghost"
            onPress={() => toggle(minimized, p.id)}
          />
          <Heading level={3}>{p.name}</Heading>
          {p.host ? <Badge tone="neutral">{`☁ ${p.host}`}</Badge> : null}
          {p.isActive ? <Badge tone="accent">Active</Badge> : null}
          <Button size="xs" icon="open-external" variant="ghost" disabled={disabled || p.host !== null} tooltip={p.host ? REMOTE_TIP : undefined} onPress={() => open(p.mainWorktreeId!)}>
            Open main
          </Button>
        </Row>
        <Row gap="none">
          <IconButton
            icon="star"
            label={isPinned ? `Unpin ${p.name}` : `Pin ${p.name}`}
            size="xs"
            variant={isPinned ? 'solid' : 'ghost'}
            tone={isPinned ? 'accent' : 'neutral'}
            onPress={() => toggle(pinned, p.id)}
          />
          <IconButton
            icon="refresh"
            label={p.tickets ? 'Recount tickets' : 'Count tickets'}
            size="xs"
            variant="ghost"
            disabled={p.ticketsLoading || !p.ticketSource}
            onPress={() => refreshTickets(p.id)}
          />
          <IconButton icon="close" label={`Hide ${p.name}`} size="xs" variant="ghost" onPress={() => setHidden(p.id, true)} />
        </Row>
      </Row>
      <Row gap="xs" wrap>
        {p.isActive && p.activeWorkspace && !p.workspaces.find((w) => w.isActive)?.isMain ? (
          <Badge tone="accent">{`▶ ${p.activeWorkspace}`}</Badge>
        ) : null}
        {p.attentionCount > 0 ? <Badge tone="warning">{p.attentionCount} need you</Badge> : <Badge tone="neutral">quiet</Badge>}
        {p.merging ? <Badge tone="accent">Merging…</Badge> : null}
        {p.runningAgents > 0 ? <Badge tone="accent">{p.runningAgents} working</Badge> : null}
        {p.openPrs > 0 ? <Badge tone="neutral">{p.openPrs} PR open</Badge> : null}
        {ready > 0 ? <Badge tone="success">{ready} ready to launch</Badge> : null}
        {p.cleanupCount > 0 ? <Badge tone="neutral">{p.cleanupCount} to clean</Badge> : null}
      </Row>
      {isMin ? null : (
      <Stack gap="sm">
        {ticketLine(p)}
        <Row gap="xs" wrap>
          <Button size="xs" icon="rocket" tone={ready > 0 ? 'accent' : 'neutral'} variant={ready > 0 ? 'solid' : 'outline'} disabled={disabled} onPress={() => runSkill(p, 'launch-tickets')}>
            Launch tickets
          </Button>
          <Button
            size="xs"
            icon="branch"
            tone={p.readyPrs > 0 && !p.merging ? 'accent' : 'neutral'}
            variant={p.readyPrs > 0 && !p.merging ? 'solid' : 'outline'}
            disabled={disabled || p.merging}
            tooltip={p.merging ? MERGING_TIP : undefined}
            onPress={() => runSkill(p, 'merge-tickets')}
          >
            {p.merging ? 'Merging…' : 'Merge tickets'}
          </Button>
          <Button size="xs" icon="delete" variant={p.cleanupCount > 0 ? 'solid' : 'outline'} disabled={disabled} onPress={() => runSkill(p, 'clean-workspaces')}>
            Clean workspaces
          </Button>
          <Button size="xs" icon="add" variant="outline" disabled={disabled} onPress={() => set(writeFor, writing ? null : p.id)}>
            Write ticket
          </Button>
        </Row>
        {writing ? (
          <Input
            label={`Describe the new ticket for ${p.name}`}
            labelHidden
            placeholder="Describe the ticket, then press Enter"
            value={read(draft)}
            onChange={(v) => set(draft, v)}
            onSubmit={(v) => {
              set(writeFor, null)
              set(draft, '')
              return runSkill(p, 'write-ticket', v)
            }}
          />
        ) : null}
        <Collapsible
          title={`Workspaces (${p.workspaces.length})`}
          open={isOpen}
          onChange={(o) => update(expanded, (e) => ({ ...e, [p.id]: o }))}
        >
          <Table
            label={`${p.name} workspaces`}
            maxHeight="md"
            columns={[
              { key: 'name', label: 'Workspace', width: 'auto', minWidth: 'sm' },
              { key: 'agent', label: 'Agent', width: 'xs' },
              { key: 'pr', label: 'PR', width: 'sm', hideBelow: 'sm' },
              { key: 'status', label: 'Status', width: 'sm', hideBelow: 'md' },
              { key: 'activity', label: 'Active', width: 'xs', hideBelow: 'md' }
            ]}
            rows={workspaceRows(p)}
            onRowAction={p.host ? undefined : ({ key }) => open(key)}
          />
        </Collapsible>
      </Stack>
      )}
    </Box>
  )
}

export default function Panel() {
  const s = read(snapshot)
  const note = read(notice)
  const working = read(busy)
  if (!s) {
    return (
      <Stack gap="md">
        {note ? <Callout tone={note.tone} title={note.tone === 'danger' ? 'That did not work' : 'Done'} icon={note.tone === 'danger' ? 'error' : 'check'}>{note.text}</Callout> : null}
        <EmptyState title="Reading your workspaces…" icon="gauge" />
      </Stack>
    )
  }
  const pins = read(pinned)
  // Pinned projects first; otherwise keep the worker's order (attention, then recent activity).
  const visible = s.projects
    .filter((p) => !p.hidden)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => Number(pins[b.p.id] === true) - Number(pins[a.p.id] === true) || a.i - b.i)
    .map(({ p }) => p)
  const hidden = s.projects.filter((p) => p.hidden)
  const byId = new Map(s.projects.map((p) => [p.id, p]))
  const activeProject = s.projects.find((p) => p.isActive) ?? null
  return (
    <Stack gap="md">
      <Row justify="between">
        <Row gap="xs">
          <Heading level={1}>Overview</Heading>
          <Badge tone={s.attention.length ? 'warning' : 'success'}>{s.attention.length ? `${s.attention.length} need you` : 'all clear'}</Badge>
        </Row>
        <Row gap="xs">
          {working ? <Text size="xs" muted>{working}…</Text> : <RelativeTime at={s.updatedAt} format="short" muted />}
          <IconButton icon="refresh" label="Refresh" size="sm" variant="ghost" disabled={working !== null} onPress={refresh} />
        </Row>
      </Row>
      {activeProject ? (
        <Row gap="xs">
          <Text size="sm" muted>
            Active:
          </Text>
          <Text size="sm" weight="semibold" tone="accent" truncate>
            {activeProject.name}
            {activeProject.activeWorkspace ? ` · ${activeProject.activeWorkspace}` : ''}
          </Text>
        </Row>
      ) : null}
      {s.warnings.map((w) => (
        <Callout tone="warning" title="A paired server could not be read">
          {w}
        </Callout>
      ))}
      {s.error ? (
        <Callout tone="danger" title="Could not read Orca's workspaces">
          {s.error}
        </Callout>
      ) : null}
      {note ? (
        <Callout tone={note.tone} title={note.tone === 'danger' ? 'That did not work' : 'Done'} icon={note.tone === 'danger' ? 'error' : 'check'}>
          <Row justify="between" gap="sm">
            <Text size="sm">{note.text}</Text>
            <IconButton icon="close" label="Dismiss" size="xs" variant="ghost" onPress={() => set(notice, null)} />
          </Row>
        </Callout>
      ) : null}

      <Stack gap="sm">
        <Heading level={2}>Needs you</Heading>
        {s.attention.length === 0 ? (
          <Text muted size="sm">Nothing is waiting on you.</Text>
        ) : (
          (read(showAll) ? s.attention : s.attention.slice(0, ATTENTION_LIMIT)).map((item) => (
            <AttentionCard item={item} project={byId.get(item.projectId)} />
          ))
        )}
        {s.attention.length > ATTENTION_LIMIT ? (
          <Button size="xs" variant="ghost" icon={read(showAll) ? 'collapse' : 'expand'} onPress={() => update(showAll, (v) => !v)}>
            {read(showAll) ? 'Show fewer' : `Show all ${s.attention.length}`}
          </Button>
        ) : null}
      </Stack>

      <Stack gap="sm">
        <Heading level={2}>Projects</Heading>
        {visible.length === 0 ? <EmptyState title="No projects" description="Orca has no workspaces to show." icon="folder" /> : null}
        {visible.map((p) => (
          <ProjectCard p={p} />
        ))}
        {hidden.length > 0 ? (
          <Collapsible title={`Hidden projects (${hidden.length})`} defaultOpen={false}>
            <Stack gap="xs">
              {hidden.map((p) => (
                <Row justify="between">
                  <Text size="sm">
                    {p.name}
                    {p.attentionCount ? ` · ${p.attentionCount} flagged` : ''}
                  </Text>
                  <Button size="xs" variant="ghost" onPress={() => setHidden(p.id, false)}>
                    Show
                  </Button>
                </Row>
              ))}
            </Stack>
          </Collapsible>
        ) : null}
      </Stack>
    </Stack>
  )
}
