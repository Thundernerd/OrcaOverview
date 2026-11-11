// The engine's storage in the desktop app (ticket counts, hidden projects, notified items) and the
// window's view state: one JSON file, so all of it survives a restart.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { EngineDeps } from '../../../core/engine.ts'

/**
 * The saved values, or none when the file is missing (the first launch) or can't be read as an
 * object. Starting empty beats not starting: the engine can't refresh until its storage loads.
 */
async function readValues(file: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Missing or corrupt: fall through to empty.
  }
  return {}
}

/** Keeps every key in `file`; reads it once, and writes the whole file on each change. */
export function fileStorage(file: string): EngineDeps['storage'] {
  let values: Promise<Record<string, unknown>> | null = null
  // Writes run one after another, so an older one can't land after a newer one.
  let writing: Promise<void> = Promise.resolve()

  const load = () => (values ??= readValues(file))

  return {
    async get(key) {
      return (await load())[key]
    },
    async set(key, value) {
      const all = await load()
      all[key] = value
      const text = JSON.stringify(all, null, 2)
      // A failed write rejects its own caller, not the writes queued after it.
      writing = writing.catch(() => undefined).then(async () => {
        await mkdir(dirname(file), { recursive: true })
        // Write next to the file and rename over it: a crash mid-write leaves the old file whole.
        await writeFile(`${file}.tmp`, text)
        await rename(`${file}.tmp`, file)
      })
      return writing
    }
  }
}
