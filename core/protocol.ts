// The overview's data and the requests that carry it, shared by the plugin (src/) and the desktop app
// (desktop/). The plugin declares OverviewRequests to Orca in src/protocol.ts.

export type AttentionKind = 'agent-waiting' | 'flagged' | 'pr-ready' | 'ci-failing'

export type Skill = 'launch-tickets' | 'merge-tickets' | 'clean-workspaces' | 'write-ticket'

/** Everything about one workspace that needs you, merged into one item. */
export interface AttentionItem {
  /** One per workspace, stable across refreshes. */
  key: string
  /** The most urgent of `kinds`: it decides the order and the border. */
  kind: AttentionKind
  /** Every reason the workspace needs you, most urgent first. */
  kinds: AttentionKind[]
  /** One line per entry of `kinds`, in the same order. */
  reasons: string[]
  /** `reasons` joined, for the status bar and notifications. */
  reason: string
  /** `<kind>:<worktreeId>` per kind: a new kind on a known workspace still notifies. */
  notifyKeys: string[]
  projectId: string
  projectName: string
  worktreeId: string
  workspaceName: string
  /** When the oldest of its conditions started, as far as Orca knows (ms). */
  since: number | null
}

export interface PrInfo {
  number: number
  state: string
  checks: 'success' | 'failure' | 'pending' | 'none'
  url: string | null
}

export interface WorkspaceRow {
  worktreeId: string
  name: string
  isMain: boolean
  /** The workspace Orca is showing now. */
  isActive: boolean
  status: string | null
  issue: number | null
  pr: PrInfo | null
  /** The most urgent state of the workspace's agents, or null without agents. */
  agentState: 'working' | 'blocked' | 'waiting' | 'done' | null
  agentSince: number | null
  lastMessage: string | null
  comment: string | null
  unread: boolean
  lastActivityAt: number | null
  attention: AttentionKind[]
  /** Merged or marked completed: /clean-workspaces can remove it. */
  cleanable: boolean
}

export interface TicketCounts {
  ready: number
  blocked: number
  launched: number
  owned: number
  claimed: number
  readyTitles: string[]
  fetchedAt: number
  error: string | null
}

export interface Project {
  id: string
  name: string
  /** The paired Orca server (environment) it lives on; null on this machine. */
  host: string | null
  /** The project whose ticket survey is shown: itself, or for a remote project its local checkout. */
  ticketSource: string | null
  mainWorktreeId: string | null
  mainPath: string | null
  /** One of its workspaces is the one Orca is showing now. */
  isActive: boolean
  /** /merge-tickets is running in its main workspace (or was just started from the panel). */
  merging: boolean
  /** Name of the active workspace, when the project is active. */
  activeWorkspace: string | null
  hidden: boolean
  /** Has ever launched a ticket workspace (linked issue or gh-<n> branch). */
  usesTickets: boolean
  attentionCount: number
  runningAgents: number
  openPrs: number
  readyPrs: number
  cleanupCount: number
  lastActivityAt: number
  tickets: TicketCounts | null
  ticketsLoading: boolean
  workspaces: WorkspaceRow[]
}

export interface Snapshot {
  projects: Project[]
  attention: AttentionItem[]
  updatedAt: number
  error: string | null
  /** Hosts that could not be read this time, e.g. a paired server that is offline. */
  warnings: string[]
}

export interface RunResult {
  how: 'sent' | 'launched'
  message: string
}

/** The requests a view sends to whatever runs the engine: the plugin's worker or the app's main process. */
export interface OverviewRequests {
  /** The latest snapshot (refreshes first when there is none yet). */
  'overview.snapshot': { output: Snapshot }
  /** Re-reads Orca's workspaces now. */
  'overview.refresh': { output: Snapshot }
  /** Re-runs the ticket survey for one project. */
  'overview.refreshTickets': { input: { projectId: string }; output: Snapshot }
  /** Runs one of the ticket skills in the project's main workspace. */
  'overview.runSkill': {
    input: { projectId: string; skill: Skill; args?: string }
    output: RunResult
  }
  /** Shows a workspace in Orca. */
  'overview.open': { input: { worktreeId: string }; output: { ok: true } }
  /** Types a reply into the workspace's waiting agent. */
  'overview.reply': { input: { worktreeId: string; text: string }; output: RunResult }
  /** Clears the workspace's unread flag. */
  'overview.markRead': { input: { worktreeId: string }; output: Snapshot }
  /** Hides or shows a project. */
  'overview.setHidden': { input: { projectId: string; hidden: boolean }; output: Snapshot }
}

/** What a request takes: its `input`, or nothing. */
export type RequestInput<K extends keyof OverviewRequests> = OverviewRequests[K] extends { input: infer I } ? I : undefined
