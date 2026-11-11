// Acting on workspaces: running a ticket skill, replying to an agent, opening, marking read.
// Every CLI call names the workspace's host: rows from a paired server carry `env`.
import { OrcaError, orcaJson as cliOrcaJson } from './cli.ts'
import { handleForPane, isIdleClaude, isWaiting, type PsAgent, type PsWorktree } from './model.ts'
import type { RunResult, Skill } from './protocol.ts'

/** Shows a local workspace in Orca's window: the plugin through its host API, the desktop app through the CLI. */
export interface Opener {
  open(w: PsWorktree): Promise<void>
}

/** Runs `orca <args> --json` and returns `result`, like `orcaJson` in cli.ts. */
export type OrcaJson = <T>(args: string[], timeoutMs?: number) => Promise<T>

export interface TerminalRow {
  handle: string
  tabId?: string
  leafId?: string
}

/** `--environment <name>` for a paired server's workspace, nothing for this machine. */
function envArgs(env: string | null | undefined): string[] {
  return env ? ['--environment', env] : []
}

/** The selector the workspace's own host knows it by. */
export function selector(w: PsWorktree): string {
  return `id:${w.rawWorktreeId ?? w.worktreeId}`
}

const FOCUS_ORDER = ['blocked', 'waiting', 'working', 'done']

/** The agent to show when opening a workspace: the one that needs you, else the busiest. */
function agentsByUrgency(agents: PsAgent[]): PsAgent[] {
  const rank = (a: PsAgent) => {
    if (isWaiting(a)) return 0
    const i = FOCUS_ORDER.indexOf(a.state ?? '')
    return i < 0 ? FOCUS_ORDER.length : i
  }
  return [...agents].sort((a, b) => rank(a) - rank(b))
}

export function skillPrompt(skill: Skill, args?: string): string {
  const extra = args?.trim()
  return extra ? `/${skill} ${extra}` : `/${skill}`
}

/**
 * Why a paired server's workspace cannot be opened from a plugin (Orca 1.4.253): the host API's
 * workspace.list/open only reach this machine, and every CLI command with `--environment` runs on
 * the server, so `worktree activate` and `terminal switch` move the server's own window when it has
 * one, not this Mac's. Orca has no deep link to a workspace either.
 */
export const REMOTE_OPEN_UNSUPPORTED = 'Orca cannot open a paired server’s workspace from a plugin yet; use the sidebar.'

/** The actions, running the `orca` CLI through `orcaJson` (tests pass a fake). */
export function orcaActions(orcaJson: OrcaJson = cliOrcaJson) {
  async function terminalsOf(w: PsWorktree): Promise<TerminalRow[]> {
    const result = await orcaJson<{ terminals: TerminalRow[] }>(['terminal', 'list', '--worktree', selector(w), ...envArgs(w.env)])
    return result.terminals ?? []
  }

  async function handleFor(w: PsWorktree, agents: PsAgent[]): Promise<string | null> {
    if (agents.length === 0) return null
    const terminals = await terminalsOf(w)
    for (const agent of agents) {
      const handle = handleForPane(agent.paneKey, terminals)
      if (handle) return handle
    }
    return null
  }

  async function send(w: PsWorktree, handle: string, text: string): Promise<void> {
    const env = envArgs(w.env)
    try {
      await orcaJson(['terminal', 'send', '--terminal', handle, '--text', text, '--enter', '--wait-submit', '15', ...env], 30_000)
    } catch (error) {
      // An agent showing a permission or trust menu refuses text+Enter in one go: send them apart.
      if (!(error instanceof OrcaError && error.code === 'agent_prompt_blocked')) throw error
      await orcaJson(['terminal', 'send', '--terminal', handle, '--text', text, ...env])
      await orcaJson(['terminal', 'send', '--terminal', handle, '--enter', ...env])
    }
  }

  async function focusTerminal(w: PsWorktree, handle: string): Promise<void> {
    await orcaJson(['terminal', 'switch', '--terminal', handle, ...envArgs(w.env)])
  }

  /** Types the skill into an idle Claude session in the main workspace, or starts a new one. */
  async function runSkill(opener: Opener, main: PsWorktree, skill: Skill, args?: string): Promise<RunResult> {
    const prompt = skillPrompt(skill, args)
    const where = main.env ? `${main.repo} on ${main.env}` : main.repo
    const idle = (main.agents ?? []).filter(isIdleClaude)
    const handle = await handleFor(main, idle)
    let result: RunResult
    if (handle) {
      await send(main, handle, prompt)
      result = { how: 'sent', message: `Sent ${prompt} to the idle Claude session in ${where}.` }
    } else {
      await orcaJson(['agent', 'launch', '--agent', 'claude', '--worktree', selector(main), '--prompt', prompt, ...envArgs(main.env)], 60_000)
      result = { how: 'launched', message: `Started Claude with ${prompt} in ${where}.` }
    }
    // The skills ask for confirmation before they act: show the session so the question is seen.
    // A new launch shows its own tab; a reused session needs switching to. A paired server's
    // workspace cannot be shown from here (REMOTE_OPEN_UNSUPPORTED), so say where to look instead.
    if (main.env) return { ...result, message: `${result.message} Open it from the ${main.env} section of the sidebar.` }
    if (handle) await openAgent(opener, main, handle).catch(() => undefined)
    else await openWorkspace(opener, main).catch(() => undefined)
    return result
  }

  /** Types a reply into the workspace's waiting agent (or its only agent). */
  async function reply(w: PsWorktree, text: string): Promise<RunResult> {
    const agents = w.agents ?? []
    const waiting = agents.filter(isWaiting)
    const handle = await handleFor(w, waiting.length > 0 ? waiting : agents)
    if (!handle) throw new Error(`No agent terminal found in ${w.displayName ?? w.path}.`)
    await send(w, handle, text)
    return { how: 'sent', message: `Replied in ${w.displayName ?? w.path}.` }
  }

  /** Shows a local workspace in Orca's window; a paired server's cannot be shown. */
  async function openWorkspace(opener: Opener, w: PsWorktree): Promise<void> {
    if (w.env) throw new Error(REMOTE_OPEN_UNSUPPORTED)
    await opener.open(w)
  }

  /** Opens the workspace on the tab of the agent that needs you (or its busiest agent, or `handle`). */
  async function openAgent(opener: Opener, w: PsWorktree, handle?: string): Promise<void> {
    await openWorkspace(opener, w)
    const target = handle ?? (await handleFor(w, agentsByUrgency(w.agents ?? [])).catch(() => null))
    if (target) await focusTerminal(w, target)
  }

  async function markRead(w: PsWorktree): Promise<void> {
    await orcaJson(['worktree', 'set', '--worktree', selector(w), '--read', ...envArgs(w.env)])
  }

  return { terminalsOf, runSkill, reply, openAgent, markRead }
}
