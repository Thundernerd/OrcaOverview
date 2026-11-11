// Smoke test of the built app (`npm run build` first): launched against a fake `orca` CLI, the menu
// bar shows how many items need you. Named *.smoke.ts so `orca plugin test` leaves it alone: it
// needs the built .app. Run it with `npm run smoke`.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const DIST = join(import.meta.dirname, '..', 'dist')
const APP_NAME = 'Orca Overview'

/** The executable inside the built .app, whatever the architecture folder is called. */
function builtExecutable(): string {
  const dir = existsSync(DIST) ? readdirSync(DIST).find((d) => d.startsWith('mac') && existsSync(join(DIST, d, `${APP_NAME}.app`))) : undefined
  assert.ok(dir, `no ${APP_NAME}.app under ${DIST}; run npm run build first`)
  return join(DIST, dir, `${APP_NAME}.app`, 'Contents', 'MacOS', APP_NAME)
}

const row = (name: string, extra: object = {}) => ({
  worktreeId: `example-app-id::/ws/example-app/${name}`,
  repoId: 'example-app-id',
  repo: 'example-app',
  path: `/ws/example-app/${name}`,
  displayName: name,
  parentWorktreeId: 'example-app-id::/ws/example-app/main',
  ...extra
})

/** Two workspaces flagged unread: two items need you. */
const TWO_UNREAD = {
  ok: true,
  result: {
    worktrees: [
      row('main', { isMainWorktree: true, parentWorktreeId: null }),
      row('feat-a', { unread: true }),
      row('feat-b', { unread: true }),
      row('feat-c')
    ]
  }
}

/** A stand-in for the `orca` CLI: `worktree ps` lists TWO_UNREAD, anything else succeeds with nothing. */
function fakeOrca(dir: string): string {
  const file = join(dir, 'orca')
  writeFileSync(
    file,
    `#!/bin/sh
if [ "$1 $2" = "worktree ps" ]; then
  cat <<'JSON'
${JSON.stringify(TWO_UNREAD)}
JSON
else
  echo '{"ok":true,"result":{}}'
fi
`
  )
  chmodSync(file, 0o755)
  return file
}

test('the built app shows the needs-you count in the menu bar', async () => {
  const exe = builtExecutable()
  const dir = mkdtempSync(join(tmpdir(), 'orca-overview-smoke-'))
  // Its own user-data folder, so the single-instance lock there doesn't hand off to another copy.
  const app = spawn(exe, [`--user-data-dir=${dir}`], { env: { ...process.env, ORCA_OVERVIEW_CLI: fakeOrca(dir) }, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const title = await new Promise<string>((resolve, reject) => {
      let out = ''
      const timer = setTimeout(() => reject(new Error(`no menu bar count within 20 s; output:\n${out}`)), 20_000)
      const read = (chunk: Buffer) => {
        out += chunk.toString()
        const counts = [...out.matchAll(/^menu bar: (.*)$/gm)].map((m) => m[1])
        const last = counts.at(-1)
        if (last && last !== '…') {
          clearTimeout(timer)
          resolve(last)
        }
      }
      app.stdout.on('data', read)
      app.stderr.on('data', read)
      app.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`the app exited (${code}) before showing a count; output:\n${out}`))
      })
    })
    assert.equal(title, '2')
  } finally {
    // Wait for the app to exit before removing its user-data folder: until then it still writes there.
    if (app.exitCode === null && app.signalCode === null) {
      const exited = new Promise((resolve) => app.once('exit', resolve))
      app.kill()
      // If it doesn't quit on SIGTERM, don't hang the test: force it.
      const force = setTimeout(() => app.kill('SIGKILL'), 5_000)
      await exited
      clearTimeout(force)
    }
    // Its helper processes can outlive it by a moment, still writing to the folder.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
