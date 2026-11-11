import { assert, mockHost, mount, test } from 'orca/testing'
import { busySnapshot, quietSnapshot } from '../core/fixture.ts'
import * as panel from './panel.tsx'

function host(snapshot = busySnapshot(), calls: { name: string; input: unknown }[] = []) {
  const record = <T,>(name: string, answer: T) => (input: unknown): T => {
    calls.push({ name, input })
    return answer
  }
  return mockHost({
    capabilities: ['storage:own'],
    requests: {
      'overview.snapshot': () => snapshot,
      'overview.refresh': () => snapshot,
      'overview.runSkill': record('runSkill', { how: 'sent', message: 'Sent /launch-tickets to the idle Claude session in atlas.' }),
      'overview.reply': record('reply', { how: 'sent', message: 'Replied.' }),
      'overview.open': record('open', { ok: true }),
      'overview.markRead': record('markRead', snapshot),
      'overview.setHidden': record('setHidden', snapshot),
      'overview.refreshTickets': record('refreshTickets', snapshot)
    }
  })
}

test('lists what needs attention, longest waiting first', async () => {
  const view = await mount(panel, { host: host() })
  assert.ok(view.summary().includes('Heading "Needs you"'))
  assert.ok(view.find({ text: 'Agent waiting' }), 'blocked agent shown')
  assert.ok(view.find({ text: 'CI failing' }), 'failing CI shown')
  assert.ok(view.find({ text: 'Ready to merge' }), 'green PR shown')
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  await view.unmount()
})

test('runs a skill in the project and shows the result', async () => {
  const calls: { name: string; input: unknown }[] = []
  const view = await mount(panel, { host: host(busySnapshot(), calls) })
  await view.press({ text: 'Launch tickets' })
  assert.deepEqual(calls[0], { name: 'runSkill', input: { projectId: 'atlas-id', skill: 'launch-tickets' } })
  assert.ok(view.find({ text: 'Sent /launch-tickets to the idle Claude session in atlas.' }))
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('replies to a waiting agent', async () => {
  const calls: { name: string; input: unknown }[] = []
  const view = await mount(panel, { host: host(busySnapshot(), calls) })
  await view.press({ text: 'Reply' })
  await view.type({ label: 'Reply to the agent in refactor/gh-65-tier-type' }, 'Use a newtype', { submit: true })
  assert.deepEqual(calls.at(-1), {
    name: 'reply',
    input: { worktreeId: 'atlas-id::/ws/atlas/refactor/gh-65-tier-type', text: 'Use a newtype' }
  })
  await view.unmount()
})

test('writes a ticket from the project card', async () => {
  const calls: { name: string; input: unknown }[] = []
  const view = await mount(panel, { host: host(quietSnapshot(), calls) })
  await view.press({ text: 'Write ticket' })
  await view.type({ label: 'Describe the new ticket for Quiet' }, 'Add dark mode', { submit: true })
  assert.deepEqual(calls.at(-1), { name: 'runSkill', input: { projectId: 'Quiet-id', skill: 'write-ticket', args: 'Add dark mode' } })
  assert.ok(view.find({ text: 'Nothing is waiting on you.' }))
  await view.unmount()
})

test('pins a project to the top and minimizes it to its header', async () => {
  const view = await mount(panel, { host: host() })
  const names = () => view.findAll({ role: 'heading' }).map((h) => h.text).filter((t) => ['atlas', 'beacon', 'Quiet'].includes(t))
  assert.deepEqual(names(), ['atlas', 'beacon', 'Quiet'])
  await view.press({ label: 'Pin Quiet' })
  assert.deepEqual(names(), ['Quiet', 'atlas', 'beacon'])
  assert.deepEqual(view.persisted.plugin.pinned, { 'Quiet-id': true })

  assert.equal(view.findAll({ text: 'Launch tickets' }).length, 4)
  await view.press({ label: 'Minimize atlas' })
  assert.equal(view.findAll({ text: 'Launch tickets' }).length, 3)
  assert.ok(view.find({ label: 'Expand atlas' }))
  assert.ok(view.findAll({ text: '2 need you' }).length === 1, 'atlas badges stay visible when minimized')
  await view.unmount()
})

test('highlights the project Orca is showing', async () => {
  const view = await mount(panel, { host: host() })
  assert.ok(view.find({ text: 'Active' }), 'badge on the active card')
  assert.ok(view.find({ text: 'beacon · main' }), 'active project named at the top')
  await view.unmount()
})

test('labels a project on a paired server with its host', async () => {
  const view = await mount(panel, { host: host() })
  assert.ok(view.find({ text: '☁ devbox' }))
  await view.unmount()
})

test('an attention card opens its project main workspace', async () => {
  const calls: { name: string; input: unknown }[] = []
  const view = await mount(panel, { host: host(busySnapshot(), calls) })
  // The first card is atlas's blocked agent; its Open main is the first one drawn.
  await view.press({ text: 'Open main' })
  assert.deepEqual(calls.at(-1), { name: 'open', input: { worktreeId: 'atlas-id::/ws/atlas/main' } })
  await view.unmount()
})

test('a paired server workspace cannot be opened from here, but is labelled', async () => {
  const view = await mount(panel, { host: host() })
  const opens = view.findAll({ text: 'Open' }).filter((b) => b.props?.tooltip)
  assert.ok(opens.length >= 1, 'remote Open is disabled with a tooltip')
  assert.ok(opens.every((b) => b.props?.disabled === true))
  assert.ok(view.findAll({ text: '☁ devbox' }).length >= 2, 'badge on the card and the project')
  await view.unmount()
})

test('opens the main workspace from the project header', async () => {
  const calls: { name: string; input: unknown }[] = []
  const view = await mount(panel, { host: host(busySnapshot(), calls) })
  await view.press({ text: 'Open main' })
  assert.deepEqual(calls.at(-1), { name: 'open', input: { worktreeId: 'atlas-id::/ws/atlas/main' } })
  await view.unmount()
})


test('a project that is merging shows it and does not start a second merge', async () => {
  const snapshot = busySnapshot()
  const gen = snapshot.projects.find((p) => p.name === 'atlas')!
  gen.merging = true
  const view = await mount(panel, { host: host(snapshot) })
  const buttons = view.findAll({ text: 'Merging…' }).filter((n) => n.props?.disabled !== undefined)
  assert.ok(buttons.length >= 1)
  assert.ok(buttons.every((b) => b.props?.disabled === true))
  await view.unmount()
})
