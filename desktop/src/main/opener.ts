// Opens workspaces through the `orca` CLI, for core/actions.ts. The plugin uses Orca's host API
// instead (src/opener.ts); an app outside Orca has only the CLI (docs/spikes/open-from-cli.md).
import { selector, type Opener, type OrcaJson } from '../../../core/actions.ts'

/** Shows a local workspace in Orca's window, on its last tab. */
export function cliOpener(orcaJson: OrcaJson): Opener {
  return {
    async open(w) {
      await orcaJson(['worktree', 'activate', '--worktree', selector(w)])
    }
  }
}
