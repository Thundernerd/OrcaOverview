// A placeholder window: the snapshot as plain lists. The real UI comes with #6.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Snapshot } from '../../../core/protocol.ts'
import '../preload/api.ts'

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  useEffect(() => {
    void window.overview.request('overview.snapshot').then(setSnapshot)
    return window.overview.onSnapshot(setSnapshot)
  }, [])
  if (!snapshot) return <p>Loading…</p>
  return (
    <>
      <button onClick={() => void window.overview.request('overview.refresh').then(setSnapshot)}>Refresh</button>{' '}
      <small>Updated {new Date(snapshot.updatedAt).toLocaleTimeString()}</small>
      {snapshot.error && <p className="error">{snapshot.error}</p>}
      {snapshot.warnings.map((w) => (
        <p key={w} className="error">
          {w}
        </p>
      ))}
      <h2>Needs you ({snapshot.attention.length})</h2>
      <ul>
        {snapshot.attention.map((a) => (
          <li key={a.key}>
            {a.projectName} · {a.workspaceName}: {a.reason}
          </li>
        ))}
      </ul>
      <h2>Projects ({snapshot.projects.length})</h2>
      <ul>
        {snapshot.projects.map((p) => (
          <li key={p.id}>
            {p.name}
            {p.host ? ` (on ${p.host})` : ''}: {p.attentionCount} need you, {p.runningAgents} working, {p.openPrs} open PRs
            <ul>
              {p.workspaces.map((w) => (
                <li key={w.worktreeId}>
                  {w.name}
                  {w.isActive ? ' (active)' : ''}
                  {w.agentState ? `: ${w.agentState}` : ''}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
