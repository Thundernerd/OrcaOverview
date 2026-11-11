// The panel <-> worker contract: the requests and events src/panel.tsx and src/worker.ts share.
// The data they carry lives in core/protocol.ts.
import type { RunResult, Skill, Snapshot } from '../core/protocol.ts'

declare module 'orca' {
  interface PluginRequests {
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
  interface PluginPanelEvents {
    /** Posted after every refresh. */
    'overview.snapshot': Snapshot
  }
}
