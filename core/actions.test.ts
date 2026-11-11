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
  const orcaJson: OrcaJson = async <T,>(args: string[]) => {
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
