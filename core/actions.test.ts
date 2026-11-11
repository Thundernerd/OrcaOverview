import { assert, test } from 'orca/testing'
import { orcaActions, type Opener, type OrcaJson } from './actions.ts'
import type { PsWorktree } from './model.ts'

const main: PsWorktree = {
  worktreeId: 'example-app-id::/ws/example-app/main',
  repoId: 'example-app-id',
  repo: 'example-app',
  path: '/ws/example-app/main',
  displayName: 'main',
  isMainWorktree: true
}

/** A fake `orca` CLI: records every call and lists `terminals` for `terminal list`. */
function fakeOrca(terminals: { handle: string; tabId?: string; leafId?: string }[] = []) {
  const calls: string[][] = []
  const orcaJson: OrcaJson = async <T>(args: string[]) => {
    calls.push(args)
    return (args[0] === 'terminal' && args[1] === 'list' ? { terminals } : {}) as T
  }
  return { calls, orcaJson }
}

function fakeOpener() {
  const opened: string[] = []
  const opener: Opener = {
    async open(w) {
      opened.push(w.path)
    }
  }
  return { opened, opener }
}

test('runSkill without an idle Claude session launches one and opens the workspace', async () => {
  const orca = fakeOrca()
  const { opened, opener } = fakeOpener()
  const result = await orcaActions(orca.orcaJson).runSkill(opener, main, 'launch-tickets')
  assert.equal(result.how, 'launched')
  assert.deepEqual(
    orca.calls.find((c) => c[0] === 'agent'),
    ['agent', 'launch', '--agent', 'claude', '--worktree', `id:${main.worktreeId}`, '--prompt', '/launch-tickets']
  )
  assert.deepEqual(opened, ['/ws/example-app/main'])
})

test('runSkill with an idle Claude session types the prompt there, then opens the workspace on its tab', async () => {
  const orca = fakeOrca([{ handle: 'term_idle', tabId: 'tab', leafId: 'leaf' }])
  const { opened, opener } = fakeOpener()
  const idle: PsWorktree = { ...main, agents: [{ agentType: 'claude', state: 'done', paneKey: 'tab:leaf' }] }
  const result = await orcaActions(orca.orcaJson).runSkill(opener, idle, 'merge-tickets', ' 12 ')
  assert.equal(result.how, 'sent')
  assert.ok(orca.calls.some((c) => c[1] === 'send' && c.includes('/merge-tickets 12')))
  assert.deepEqual(opened, ['/ws/example-app/main'])
  assert.deepEqual(orca.calls.at(-1), ['terminal', 'switch', '--terminal', 'term_idle'])
})

test('runSkill on a paired server does not open anything', async () => {
  const orca = fakeOrca()
  const { opened, opener } = fakeOpener()
  const result = await orcaActions(orca.orcaJson).runSkill(opener, { ...main, env: 'devbox' }, 'write-ticket')
  assert.match(result.message, /devbox section of the sidebar/)
  assert.deepEqual(opened, [])
})

test('openAgent opens the workspace, then switches to the tab of the agent that needs you', async () => {
  const orca = fakeOrca([
    { handle: 'term_busy', tabId: 'a', leafId: '1' },
    { handle: 'term_blocked', tabId: 'b', leafId: '2' }
  ])
  const { opened, opener } = fakeOpener()
  const w: PsWorktree = {
    ...main,
    agents: [
      { agentType: 'claude', state: 'working', paneKey: 'a:1' },
      { agentType: 'claude', state: 'blocked', paneKey: 'b:2' }
    ]
  }
  await orcaActions(orca.orcaJson).openAgent(opener, w)
  assert.deepEqual(opened, ['/ws/example-app/main'])
  assert.deepEqual(orca.calls.at(-1), ['terminal', 'switch', '--terminal', 'term_blocked'])
})

test('openAgent on a paired server refuses without calling the opener', async () => {
  const orca = fakeOrca()
  const { opened, opener } = fakeOpener()
  await assert.rejects(orcaActions(orca.orcaJson).openAgent(opener, { ...main, env: 'devbox' }), /paired server/)
  assert.deepEqual(opened, [])
})
