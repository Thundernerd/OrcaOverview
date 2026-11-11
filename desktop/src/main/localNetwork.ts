// macOS's Local Network privacy blocks the `orca` CLI the app runs from reaching paired servers on
// the LAN, and only asks for the permission when the app itself connects there. So at launch the
// main process opens (and closes) a connection to each paired server, to make macOS ask once.
import { connect } from 'node:net'
import type { OrcaJson } from '../../../core/actions.ts'

type Environments = { environments?: { endpoints?: { endpoint?: string }[] }[] }

/** host:port of each paired server's endpoint, from `orca environment list`. */
async function endpoints(orcaJson: OrcaJson): Promise<{ host: string; port: number }[]> {
  const { environments = [] } = await orcaJson<Environments>(['environment', 'list'])
  return environments.flatMap((e) =>
    (e.endpoints ?? []).flatMap(({ endpoint }) => {
      try {
        const url = new URL(endpoint ?? '')
        const port = Number(url.port) || (url.protocol === 'wss:' ? 443 : 80)
        return url.hostname ? [{ host: url.hostname, port }] : []
      } catch {
        return []
      }
    })
  )
}

/** Touches each paired server once, so macOS asks for Local Network access. Never throws. */
export async function requestLocalNetworkAccess(orcaJson: OrcaJson): Promise<void> {
  const targets = await endpoints(orcaJson).catch(() => [])
  for (const { host, port } of targets) {
    const socket = connect({ host, port })
    socket.setTimeout(3_000, () => socket.destroy())
    socket.on('connect', () => socket.destroy())
    socket.on('error', () => undefined)
  }
}
