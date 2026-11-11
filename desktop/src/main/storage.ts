// The engine's storage in the desktop app (ticket counts, hidden projects, notified items) and the
// window's view state: one JSON file, so all of it survives a restart.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { EngineDeps } from '../../../core/engine.ts'

interface Loaded {
  values: Record<string, unknown>
  /** Why saving would lose settings: the file is there but couldn't be read. */
  unreadable: string | null
}

/**
 * The saved values, or none when the file is missing (the first launch), corrupt, or unreadable.
 * Starting empty beats not starting: the engine can't refresh until its storage loads. Only an
 * unreadable file (permissions, I/O) is kept from being replaced, since it may still hold settings.
 */
async function readValues(file: string): Promise<Loaded> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { values: {}, unreadable: null }
    return { values: {}, unreadable: `${file} could not be read (${code ?? String(error)}); not saving over it` }
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { values: parsed as Record<string, unknown>, unreadable: null }
  } catch {
    // Corrupt: fall through to empty, and let the next save replace it.
  }
  return { values: {}, unreadable: null }
}

/** Keeps every key in `file`; reads it once, and writes the whole file on each change. */
export function fileStorage(file: string): EngineDeps['storage'] {
  let loaded: Promise<Loaded> | null = null
  // Writes run one after another, so an older one can't land after a newer one.
  let writing: Promise<void> = Promise.resolve()

  const load = () => (loaded ??= readValues(file))

  return {
    async get(key) {
      return (await load()).values[key]
    },
    async set(key, value) {
      const { values: all, unreadable } = await load()
      if (unreadable) throw new Error(unreadable)
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
