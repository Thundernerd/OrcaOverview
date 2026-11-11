// Opens workspaces through the plugin host API, for core/actions.ts.
import type { OrcaWorkerApi } from 'orca/worker'
import type { Opener } from '../core/actions.ts'

/** Shows a local workspace in this Mac's window (the host API's ids are its own, so match by path). */
export function hostOpener(orca: OrcaWorkerApi): Opener {
  return {
    async open(w) {
      const { workspaces } = await orca.host.call('workspace.list')
      const match = workspaces.find((x) => x.path === w.path && (x.hostId ?? 'local') === 'local') ?? workspaces.find((x) => x.path === w.path)
      if (!match) throw new Error(`Orca does not list ${w.path}.`)
      await orca.host.call('workspace.open', { workspaceId: match.id })
    }
  }
}
