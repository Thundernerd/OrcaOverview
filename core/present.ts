// How the overview is drawn, shared by the plugin's panel (src/panel.tsx) and the desktop window
// (desktop/src/renderer/App.tsx), so the two stay alike. Pure: no Orca, no React.
import type { AttentionKind, Project, WorkspaceRow } from './protocol.ts'

/** Each attention kind's badge: its label and its color. */
export const KIND: Record<AttentionKind, { label: string; tone: 'danger' | 'warning' | 'success' }> = {
  'agent-waiting': { label: 'Agent waiting', tone: 'danger' },
  flagged: { label: 'Flagged', tone: 'warning' },
  'ci-failing': { label: 'CI failing', tone: 'danger' },
  'pr-ready': { label: 'Ready to merge', tone: 'success' }
}

/** Needs you cards shown before "Show all". */
export const ATTENTION_LIMIT = 6

export const MERGING_TIP = '/merge-tickets is already running in this project’s main workspace.'

/** The PR column of the workspace table: "PR 12 open ✓", or the linked issue. */
export function prCell(w: WorkspaceRow): string {
  if (!w.pr) return w.issue ? `#${w.issue}` : '-'
  const checks = w.pr.checks === 'success' ? '✓' : w.pr.checks === 'failure' ? '✗' : w.pr.checks === 'pending' ? '…' : ''
  return `PR ${w.pr.number} ${w.pr.state}${checks ? ` ${checks}` : ''}`
}

/** The projects to list: hidden ones left out, pinned ones first, otherwise in the engine's order. */
export function visibleProjects(projects: Project[], pinned: Record<string, boolean>): Project[] {
  return projects
    .filter((p) => !p.hidden)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => Number(pinned[b.p.id] === true) - Number(pinned[a.p.id] === true) || a.i - b.i)
    .map(({ p }) => p)
}
