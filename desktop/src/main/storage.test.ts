// The engine's storage in the desktop app: one JSON file in the app's userData folder.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileStorage } from './storage.ts'

/** A fresh folder for one test, removed afterwards. */
function tempDir(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-overview-storage-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('values saved before a restart are there after it', async (t) => {
  const file = join(tempDir(t), 'settings.json')
  const before = fileStorage(file)
  await before.set('hidden', ['atlas-id'])
  await before.set('view', { pinned: { 'beacon-id': true }, minimized: {}, expanded: {} })

  const after = fileStorage(file)
  assert.deepEqual(await after.get('hidden'), ['atlas-id'])
  assert.deepEqual(await after.get('view'), { pinned: { 'beacon-id': true }, minimized: {}, expanded: {} })
})

test('a missing file reads as empty', async (t) => {
  const storage = fileStorage(join(tempDir(t), 'nested', 'settings.json'))
  assert.equal(await storage.get('hidden'), undefined)
})

test('a corrupt file reads as empty, and the next save replaces it', async (t) => {
  for (const corrupt of ['{"hidden": ["atlas', 'null', '["atlas-id"]']) {
    const file = join(tempDir(t), 'settings.json')
    writeFileSync(file, corrupt)
    const storage = fileStorage(file)
    assert.equal(await storage.get('hidden'), undefined, corrupt)

    await storage.set('notified', ['atlas-id::/ws/atlas/feat-a#unread'])
    assert.deepEqual(await fileStorage(file).get('notified'), ['atlas-id::/ws/atlas/feat-a#unread'], corrupt)
  }
})
