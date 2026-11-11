// Runs the `orca` CLI and the launch-tickets survey from the worker. Orca's plugin host API only
// sees the focused workspace, so cross-project state comes from `orca worktree ps --json`.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ORCA_CANDIDATES = ['/Applications/Orca.app/Contents/Resources/bin/orca', join(homedir(), 'Applications/Orca.app/Contents/Resources/bin/orca')]
export const ORCA = ORCA_CANDIDATES.find((p) => existsSync(p)) ?? 'orca'
export const SURVEY = join(homedir(), '.claude/skills/launch-tickets/scripts/survey.sh')

// Orca starts the worker with the GUI app's short PATH; gh, jq and git usually live in Homebrew.
const PATH = [
  join(ORCA, '..'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  process.env.PATH ?? '',
  '/usr/bin',
  '/bin'
]
  .filter(Boolean)
  .join(':')

// Error fields are plain fields, not constructor parameter properties: Node's type stripping
// can't run those, and `node --test` runs core's tests without a compile step.
export class CliError extends Error {
  readonly stderr: string
  readonly stdout: string
  constructor(message: string, stderr: string, stdout = '') {
    super(message)
    this.stderr = stderr
    this.stdout = stdout
  }
}

export function run(file: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs ?? 20_000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, PATH } },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || stdout || error.message).trim().split('\n').slice(-3).join(' ')
          reject(new CliError(`${file.split('/').pop()} ${args[0] ?? ''} failed: ${detail}`, String(stderr), String(stdout)))
        } else resolve(String(stdout))
      }
    )
  })
}

/** An error Orca reported, with its `error.code` (e.g. `agent_prompt_blocked`). */
export class OrcaError extends Error {
  readonly code: string | null
  constructor(message: string, code: string | null) {
    super(message)
    this.code = code
  }
}

type OrcaReply<T> = { ok: boolean; result?: T; error?: { message?: string; code?: string } }

function parseReply<T>(text: string): OrcaReply<T> | null {
  try {
    return JSON.parse(text) as OrcaReply<T>
  } catch {
    return null
  }
}

/** `orcaJson` for the `orca` CLI at `bin`; the desktop app's smoke test points it at a fake. */
export function orcaJsonAt(bin: string) {
  return async function orcaJson<T>(args: string[], timeoutMs?: number): Promise<T> {
    let out: string
    try {
      out = await run(bin, [...args, '--json'], { timeoutMs })
    } catch (error) {
      // Orca prints its JSON error on stdout with a non-zero exit.
      const reply = error instanceof CliError ? parseReply<T>(error.stdout) : null
      if (reply?.error) throw new OrcaError(reply.error.message ?? reply.error.code ?? 'orca failed', reply.error.code ?? null)
      throw new OrcaError(error instanceof Error ? error.message : String(error), null)
    }
    const parsed = parseReply<T>(out)
    if (!parsed) throw new OrcaError(`orca ${args[0]} printed no JSON`, null)
    if (!parsed.ok) throw new OrcaError(parsed.error?.message ?? parsed.error?.code ?? 'orca failed', parsed.error?.code ?? null)
    return parsed.result as T
  }
}

/** Runs `orca <args> --json` and returns `result`, throwing Orca's error when `ok` is false. */
export const orcaJson = orcaJsonAt(ORCA)

export function surveyTickets(cwd: string): Promise<string> {
  return run('/bin/bash', [SURVEY], { cwd, timeoutMs: 90_000 })
}

export function surveyAvailable(): boolean {
  return existsSync(SURVEY)
}
