// The panel <-> worker contract: the requests and events src/panel.tsx and src/worker.ts share.
// The requests and the data they carry live in core/protocol.ts, shared with the desktop app.
import type { OverviewRequests, Snapshot } from '../core/protocol.ts'

declare module 'orca' {
  interface PluginRequests extends OverviewRequests {}
  interface PluginPanelEvents {
    /** Posted after every refresh. */
    'overview.snapshot': Snapshot
  }
}
