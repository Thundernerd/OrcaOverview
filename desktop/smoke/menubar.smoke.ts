// Smoke test of the built app (`npm run build` first): launched against a fake `orca` CLI, the menu
// bar shows how many items need you. Named *.smoke.ts so `orca plugin test` leaves it alone: it
// needs the built .app. Run it with `npm run smoke`.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

/** What `worktree ps` answers: the main workspace and three others, the named ones flagged unread. */
function unread(...names: string[]) {
  const others = ['feat-a', 'feat-b', 'feat-c'].map((n) => row(n, names.includes(n) ? { unread: true } : {}))
  return { ok: true, result: { worktrees: [row('main', { isMainWorktree: true, parentWorktreeId: null }), ...others] } }
}

/** A fresh folder for one test: the fake CLI and the app's user data. Removed afterwards. */
function tempDir(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-overview-smoke-'))
  // The app's helper processes can outlive it by a moment, still writing to the folder.
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }))
  return dir
}

/** A stand-in for the `orca` CLI in `dir`: `worktree ps` answers what setPs wrote, anything else succeeds with nothing. */
function fakeOrca(dir: string): string {
  const file = join(dir, 'orca')
  writeFileSync(
    file,
    `#!/bin/sh
if [ "$1 $2" = "worktree ps" ]; then
  cat '${join(dir, 'ps.json')}'
else
  echo '{"ok":true,"result":{}}'
fi
`
  )
  chmodSync(file, 0o755)
  return file
}

const setPs = (dir: string, answer: object) => writeFileSync(join(dir, 'ps.json'), JSON.stringify(answer))

/**
 * Launches the built app against the fake CLI in `dir`, with `dir/user-data` as its user-data
 * folder: it doesn't touch your saved settings, and it runs next to your own copy (the
 * single-instance lock lives in that folder).
 */
function launch(dir: string) {
  const app = spawn(builtExecutable(), [`--user-data-dir=${join(dir, 'user-data')}`], {
    env: { ...process.env, ORCA_OVERVIEW_CLI: fakeOrca(dir) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let out = ''
  const waiters = new Set<() => void>()
  const read = (chunk: Buffer) => {
    out += chunk.toString()
    for (const check of [...waiters]) check()
  }
  app.stdout.on('data', read)
  app.stderr.on('data', read)
  const exited = new Promise<number | null>((resolve) => app.on('exit', resolve))
  return {
    output: () => out,
    /** Resolves with the first match of `pattern` in the output so far or still to come. */
    waitFor(pattern: RegExp, what: string, ms = 20_000): Promise<RegExpMatchArray> {
      return new Promise((resolve, reject) => {
        let settled = false
        const settle = (fn: () => void) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          waiters.delete(check)
          fn()
        }
        const check = () => {
          const m = out.match(pattern)
          if (m) settle(() => resolve(m))
        }
        const timer = setTimeout(() => settle(() => reject(new Error(`no ${what} within ${ms / 1000} s; output:\n${out}`))), ms)
        void exited.then((code) => settle(() => reject(new Error(`the app exited (${code}) before showing ${what}; output:\n${out}`))))
        waiters.add(check)
        check()
      })
    },
    /** Quits the app and waits until it has exited, so nothing writes to `dir` afterwards. */
    async quit(): Promise<void> {
      if (app.exitCode !== null || app.signalCode !== null) return
      app.kill()
      // If it doesn't quit on SIGTERM, don't hang the test: force it.
      const force = setTimeout(() => app.kill('SIGKILL'), 5_000)
      await exited
      clearTimeout(force)
    }
  }
}

/** The menu bar's count once the first refresh has replaced its placeholder. */
const COUNT = /^menu bar: (\d+)$/m

test('the built app shows the needs-you count in the menu bar', async (t) => {
  const dir = tempDir(t)
  setPs(dir, unread('feat-a', 'feat-b'))
  const app = launch(dir)
  try {
    const [, count] = await app.waitFor(COUNT, 'a menu bar count')
    assert.equal(count, '2')
  } finally {
    await app.quit()
  }
})

/** Resolves once `file` exists and contains `text`. */
async function fileContains(file: string, text: string, ms = 10_000): Promise<void> {
  const until = Date.now() + ms
  while (!(existsSync(file) && readFileSync(file, 'utf8').includes(text))) {
    if (Date.now() > until) throw new Error(`${file} never contained ${text}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

test('after a restart, only what is new since the last run is announced', async (t) => {
  const dir = tempDir(t)
  setPs(dir, unread('feat-a'))
  const first = launch(dir)
  try {
    await first.waitFor(/^menu bar: 1$/m, 'a count of 1')
    // The first run ever only remembers what is there; wait until that is saved.
    await fileContains(join(dir, 'user-data', 'settings.json'), 'example-app/feat-a')
  } finally {
    await first.quit()
  }
  assert.doesNotMatch(first.output(), /^notification:/m, 'the first run ever announces nothing')

  setPs(dir, unread('feat-a', 'feat-b'))
  const second = launch(dir)
  try {
    await second.waitFor(/^notification: example-app · feat-b$/m, 'a notification for feat-b')
    await second.waitFor(/^menu bar: 2$/m, 'a count of 2')
  } finally {
    await second.quit()
  }
  assert.deepEqual(second.output().match(/^notification: .*$/gm), ['notification: example-app · feat-b'])
})
