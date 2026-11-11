// Component tests of the window, mirroring the plugin panel's (src/panel.test.tsx). Named *.spec.tsx
// so `orca plugin test` leaves them alone: it compiles JSX for Orca's panels, not for React.
import 'global-jsdom/register'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { busySnapshot, quietSnapshot } from '../../../core/fixture.ts'
import type { Snapshot } from '../../../core/protocol.ts'
import type { OverviewApi, ViewState } from '../preload/api.ts'
import { App } from './App.tsx'

afterEach(cleanup)

type Call = { channel: string; input: unknown }

/** Stands in for the preload API: answers like the main process and records each request. */
function fakeApi(snapshot: Snapshot = busySnapshot(), calls: Call[] = [], overrides: Record<string, unknown> = {}): OverviewApi {
  const answers: Record<string, unknown> = {
    'overview.snapshot': snapshot,
    'overview.refresh': snapshot,
    'overview.runSkill': { how: 'sent', message: 'Sent /launch-tickets to the idle Claude session in atlas.' },
    'overview.reply': { how: 'sent', message: 'Replied.' },
    'overview.open': { ok: true },
    'overview.markRead': snapshot,
    'overview.setHidden': snapshot,
    'overview.refreshTickets': snapshot,
    ...overrides
  }
  let view: ViewState = { pinned: {}, minimized: {}, expanded: {} }
  return {
    loadView: async () => view,
    saveView: async (state) => void (view = state),
    request: (async (channel: string, input?: unknown) => {
      if (channel !== 'overview.snapshot') calls.push({ channel, input })
      return answers[channel]
    }) as OverviewApi['request'],
    onSnapshot: () => () => undefined
  }
}

test('lists what needs you, longest waiting first', async () => {
  render(<App api={fakeApi()} />)
  const section = await screen.findByRole('complementary', { name: 'Needs you' })
  const cards = within(section).getAllByRole('article')
  assert.deepEqual(
    cards.map((c) => within(c).getByRole('heading').textContent),
    ['atlas · refactor/gh-65-tier-type', 'beacon · ci/gh-3-smoke-test', 'atlas · feat/gh-60-non-csharp-engines', 'example-app · feat/gh-311-face']
  )
  assert.ok(within(cards[0]).getByText('Agent waiting'))
  assert.ok(within(cards[0]).getByText(/Should tiers be an enum or a newtype\?/), 'the reason, with the agent’s question')
  assert.ok(within(cards[0]).getByRole('time'), 'how long it has waited')
  assert.ok(within(section).getByText('CI failing'))
  assert.ok(within(section).getByText('Ready to merge'))
})

/** Clicks a button once it's enabled: the window runs one action at a time. */
async function press(button: HTMLElement): Promise<void> {
  await waitFor(() => assert.equal((button as HTMLButtonElement).disabled, false, `${button.textContent} stays disabled`))
  fireEvent.click(button)
}

/** The Needs you card for one workspace. */
async function card(workspace: string): Promise<HTMLElement> {
  const section = await screen.findByRole('complementary', { name: 'Needs you' })
  const found = within(section)
    .getAllByRole('article')
    .find((c) => within(c).getByRole('heading').textContent?.endsWith(` · ${workspace}`))
  assert.ok(found, `no card for ${workspace}`)
  return found
}

test('Open shows the workspace in Orca, Open main its project main workspace', async () => {
  const calls: Call[] = []
  render(<App api={fakeApi(busySnapshot(), calls)} />)
  const blocked = await card('refactor/gh-65-tier-type')
  await press(within(blocked).getByRole('button', { name: 'Open' }))
  await waitFor(() => assert.deepEqual(calls.at(-1), { channel: 'overview.open', input: { worktreeId: 'atlas-id::/ws/atlas/refactor/gh-65-tier-type' } }))
  await press(within(blocked).getByRole('button', { name: 'Open main' }))
  await waitFor(() => assert.deepEqual(calls.at(-1), { channel: 'overview.open', input: { worktreeId: 'atlas-id::/ws/atlas/main' } }))
})

test('a paired server workspace cannot be opened from here, but is labelled', async () => {
  render(<App api={fakeApi()} />)
  const remote = await card('feat/gh-311-face')
  assert.ok(within(remote).getByText('☁ devbox'))
  for (const name of ['Open', 'Open main']) {
    const button = within(remote).getByRole('button', { name })
    assert.equal((button as HTMLButtonElement).disabled, true, name)
    assert.match(button.title, /paired server/)
  }
})

test('replies to a waiting agent and shows the answer', async () => {
  const calls: Call[] = []
  render(<App api={fakeApi(busySnapshot(), calls)} />)
  const blocked = await card('refactor/gh-65-tier-type')
  await press(within(blocked).getByRole('button', { name: 'Reply' }))
  const input = within(blocked).getByRole('textbox', { name: 'Reply to the agent in refactor/gh-65-tier-type' })
  fireEvent.change(input, { target: { value: ' Use a newtype ' } })
  fireEvent.submit(input)
  await waitFor(() =>
    assert.deepEqual(calls.at(-1), { channel: 'overview.reply', input: { worktreeId: 'atlas-id::/ws/atlas/refactor/gh-65-tier-type', text: 'Use a newtype' } })
  )
  assert.ok(await screen.findByText('Replied.'))
  assert.equal(within(blocked).queryByRole('textbox'), null, 'the input closes after sending')
})

test('marks a flagged workspace read and shows the snapshot that comes back', async () => {
  const calls: Call[] = []
  const after = busySnapshot()
  after.attention = after.attention.filter((a) => a.workspaceName !== 'feat/gh-311-face')
  render(<App api={fakeApi(busySnapshot(), calls, { 'overview.markRead': after })} />)
  await press(within(await card('feat/gh-311-face')).getByRole('button', { name: 'Mark read' }))
  await waitFor(() => assert.deepEqual(calls.at(-1), { channel: 'overview.markRead', input: { worktreeId: 'devbox@@example-app-id::/ws/example-app/feat/gh-311-face' } }))
  await waitFor(() => assert.equal(within(screen.getByRole('complementary', { name: 'Needs you' })).getAllByRole('article').length, 3))
})

test('Merge tickets runs /merge-tickets in the project', async () => {
  const calls: Call[] = []
  render(<App api={fakeApi(busySnapshot(), calls)} />)
  await press(within(await card('ci/gh-3-smoke-test')).getByRole('button', { name: 'Merge tickets' }))
  await waitFor(() => assert.deepEqual(calls.at(-1), { channel: 'overview.runSkill', input: { projectId: 'beacon-id', skill: 'merge-tickets' } }))
  assert.ok(await screen.findByText('Sent /launch-tickets to the idle Claude session in atlas.'))
})

test('a project that is merging shows it and does not start a second merge', async () => {
  const snapshot = busySnapshot()
  snapshot.projects.find((p) => p.name === 'atlas')!.merging = true
  render(<App api={fakeApi(snapshot)} />)
  const button = within(await card('feat/gh-60-non-csharp-engines')).getByRole('button', { name: 'Merging…' }) as HTMLButtonElement
  assert.equal(button.disabled, true)
  assert.match(button.title, /already running/)
})

test('Needs you is a column beside the projects holding every item, with no Show all', async () => {
  const snapshot = busySnapshot()
  const flagged = snapshot.attention.at(-1)!
  snapshot.attention = Array.from({ length: 8 }, (_, i) => ({ ...flagged, key: `k${i}`, workspaceName: `feat/gh-${i}` }))
  render(<App api={fakeApi(snapshot)} />)
  const column = await screen.findByRole('complementary', { name: 'Needs you' })
  assert.deepEqual(
    within(column).getAllByRole('article').map((c) => within(c).getByRole('heading').textContent),
    Array.from({ length: 8 }, (_, i) => `example-app · feat/gh-${i}`)
  )
  assert.equal(within(column).queryByRole('button', { name: /Show all|Show fewer/ }), null)
  assert.ok(within(column).getByRole('heading', { name: 'Needs you' }))
  assert.ok(within(column).getByLabelText('8 items'), 'its heading keeps the count')
})

/** The project card titled `name`. */
async function projectCard(name: string): Promise<HTMLElement> {
  const section = await screen.findByRole('region', { name: 'Projects' })
  return within(section).getByRole('article', { name })
}

const projectNames = () => within(screen.getByRole('region', { name: 'Projects' })).getAllByRole('article').map((a) => a.getAttribute('aria-label'))

test('pins a project to the top and minimizes it to its header', async () => {
  const api = fakeApi()
  render(<App api={api} />)
  await projectCard('atlas')
  assert.deepEqual(projectNames(), ['atlas', 'beacon', 'example-app', 'Quiet'])
  fireEvent.click(within(await projectCard('Quiet')).getByRole('button', { name: 'Pin Quiet' }))
  await waitFor(() => assert.deepEqual(projectNames(), ['Quiet', 'atlas', 'beacon', 'example-app']))
  assert.deepEqual((await api.loadView()).pinned, { 'Quiet-id': true }, 'kept where saved settings can find it')

  const atlas = await projectCard('atlas')
  assert.ok(within(atlas).getByRole('button', { name: 'Launch tickets' }))
  fireEvent.click(within(atlas).getByRole('button', { name: 'Minimize atlas' }))
  assert.equal(within(atlas).queryByRole('button', { name: 'Launch tickets' }), null)
  assert.ok(within(atlas).getByRole('button', { name: 'Expand atlas' }))
  assert.ok(within(atlas).getByText('2 need you'), 'badges stay visible when minimized')
})

test('lays the project cards out in a grid, pinned first', async () => {
  render(<App api={fakeApi()} />)
  const grid = await screen.findByRole('list', { name: 'Project cards' })
  const names = () => within(grid).getAllByRole('listitem').map((li) => within(li).getByRole('article').getAttribute('aria-label'))
  assert.deepEqual(names(), ['atlas', 'beacon', 'example-app', 'Quiet'])
  fireEvent.click(within(grid).getByRole('button', { name: 'Pin beacon' }))
  await waitFor(() => assert.deepEqual(names(), ['beacon', 'atlas', 'example-app', 'Quiet']))
})

test('runs a skill in the project and shows the result', async () => {
  const calls: Call[] = []
  render(<App api={fakeApi(busySnapshot(), calls)} />)
  const atlas = await projectCard('atlas')
  await press(within(atlas).getByRole('button', { name: 'Launch tickets' }))
  await waitFor(() => assert.deepEqual(calls.at(-1), { channel: 'overview.runSkill', input: { projectId: 'atlas-id', skill: 'launch-tickets' } }))
  assert.ok(await screen.findByText('Sent /launch-tickets to the idle Claude session in atlas.'))
  await press(within(atlas).getByRole('button', { name: 'Merge tickets' }))
  await waitFor(() => assert.deepEqual(calls.at(-1), { channel: 'overview.runSkill', input: { projectId: 'atlas-id', skill: 'merge-tickets' } }))
  await press(within(atlas).getByRole('button', { name: 'Clean workspaces' }))
  await waitFor(() => assert.deepEqual(calls.at(-1), { channel: 'overview.runSkill', input: { projectId: 'atlas-id', skill: 'clean-workspaces' } }))
})

test('writes a ticket from the project card', async () => {
  const calls: Call[] = []
  render(<App api={fakeApi(quietSnapshot(), calls)} />)
  const quiet = await projectCard('Quiet')
  await press(within(quiet).getByRole('button', { name: 'Write ticket' }))
  const input = within(quiet).getByRole('textbox', { name: 'Describe the new ticket for Quiet' })
  fireEvent.change(input, { target: { value: 'Add dark mode' } })
  fireEvent.submit(input)
  await waitFor(() => assert.deepEqual(calls.at(-1), { channel: 'overview.runSkill', input: { projectId: 'Quiet-id', skill: 'write-ticket', args: 'Add dark mode' } }))
  assert.equal(within(quiet).queryByRole('textbox'), null, 'the input closes after sending')
  assert.ok(screen.getByText('Nothing is waiting on you.'))
})

test('hides a project, and shows it again from the hidden projects', async () => {
  const calls: Call[] = []
  const hidden = busySnapshot()
  hidden.projects.find((p) => p.name === 'Quiet')!.hidden = true
  render(<App api={fakeApi(busySnapshot(), calls, { 'overview.setHidden': hidden })} />)
  await press(within(await projectCard('Quiet')).getByRole('button', { name: 'Hide Quiet' }))
  await waitFor(() => assert.deepEqual(calls.at(-1), { channel: 'overview.setHidden', input: { projectId: 'Quiet-id', hidden: true } }))
  await waitFor(() => assert.deepEqual(projectNames(), ['atlas', 'beacon', 'example-app']))
  const section = screen.getByRole('group', { name: 'Hidden projects (1)' })
  await press(within(section).getByRole('button', { name: 'Show Quiet' }))
  await waitFor(() => assert.deepEqual(calls.at(-1), { channel: 'overview.setHidden', input: { projectId: 'Quiet-id', hidden: false } }))
})

test('recounts a project’s tickets', async () => {
  const calls: Call[] = []
  render(<App api={fakeApi(busySnapshot(), calls)} />)
  const atlas = await projectCard('atlas')
  assert.match(within(atlas).getByText(/^Tickets:/).textContent!, /^Tickets: 1 ready · 2 blocked · 2 launched · 0 taken/)
  await press(within(atlas).getByRole('button', { name: 'Recount tickets' }))
  await waitFor(() => assert.deepEqual(calls.at(-1), { channel: 'overview.refreshTickets', input: { projectId: 'atlas-id' } }))
  assert.equal((within(await projectCard('beacon')).getByRole('button', { name: 'Count tickets' }) as HTMLButtonElement).disabled, true, 'already counting')
  assert.ok(within(await projectCard('beacon')).getByText('Counting tickets…'))
})

test('the header counts what needs you, names the active project and refreshes', async () => {
  const calls: Call[] = []
  render(<App api={fakeApi(busySnapshot(), calls)} />)
  const header = await screen.findByRole('banner')
  assert.ok(within(header).getByText('4 need you'))
  assert.ok(within(header).getByText('beacon · main'), 'the active project and workspace')
  assert.ok(within(header).getByRole('time'), 'when it was last read')
  await press(within(header).getByRole('button', { name: 'Refresh' }))
  await waitFor(() => assert.deepEqual(calls.at(-1), { channel: 'overview.refresh', input: undefined }))
})

test('says all clear when nothing needs you', async () => {
  render(<App api={fakeApi(quietSnapshot())} />)
  assert.ok(within(await screen.findByRole('banner')).getByText('all clear'))
})

test('highlights the project Orca is showing', async () => {
  render(<App api={fakeApi()} />)
  const beacon = await projectCard('beacon')
  assert.ok(beacon.classList.contains('active'))
  assert.ok(within(beacon).getByText('Active', { selector: '.badge' }))
  assert.equal(within(await projectCard('atlas')).queryByText('Active', { selector: '.badge' }), null)
})

test('shows why the workspaces could not be read', async () => {
  const snapshot = busySnapshot()
  snapshot.error = 'orca is not running'
  snapshot.warnings = ['devbox: Could not connect to the remote Orca runtime']
  render(<App api={fakeApi(snapshot)} />)
  assert.ok(await screen.findByText('orca is not running'))
  assert.ok(screen.getByText('devbox: Could not connect to the remote Orca runtime'))
})

test('shows what went wrong when an action fails', async () => {
  const api = fakeApi()
  const request = api.request
  api.request = ((channel: string, input?: unknown) =>
    channel === 'overview.open' ? Promise.reject(new Error('Orca is not running')) : (request as (c: string, i?: unknown) => Promise<unknown>)(channel, input)) as OverviewApi['request']
  render(<App api={api} />)
  await press(within(await card('refactor/gh-65-tier-type')).getByRole('button', { name: 'Open' }))
  assert.match((await screen.findByRole('alert')).textContent!, /Open: Orca is not running/)
})

test('opens the main workspace from the project header; not on a paired server', async () => {
  const calls: Call[] = []
  render(<App api={fakeApi(busySnapshot(), calls)} />)
  await press(within(await projectCard('atlas')).getByRole('button', { name: 'Open main' }))
  await waitFor(() => assert.deepEqual(calls.at(-1), { channel: 'overview.open', input: { worktreeId: 'atlas-id::/ws/atlas/main' } }))
  const remote = await projectCard('example-app')
  assert.ok(within(remote).getByText('☁ devbox'))
  const button = within(remote).getByRole('button', { name: 'Open main' }) as HTMLButtonElement
  assert.equal(button.disabled, true)
  assert.match(button.title, /paired server/)
})

test('lists a project’s workspaces, open when one needs you, and opens one from its row', async () => {
  const calls: Call[] = []
  const api = fakeApi(busySnapshot(), calls)
  render(<App api={api} />)
  const atlas = await projectCard('atlas')
  const table = within(atlas).getByRole('table', { name: 'atlas workspaces' })
  assert.equal(table.closest('details')!.open, true, 'open: atlas has workspaces that need you')
  const quietTable = within(await projectCard('Quiet')).getByRole('table', { name: 'Quiet workspaces' })
  assert.equal(quietTable.closest('details')!.open, false, 'closed: nothing in Quiet needs you')

  const row = within(table).getByRole('row', { name: /refactor\/gh-65-tier-type/ })
  assert.ok(within(row).getByText('blocked'))
  await press(within(row).getByRole('button', { name: 'Open workspace refactor/gh-65-tier-type' }))
  await waitFor(() => assert.deepEqual(calls.at(-1), { channel: 'overview.open', input: { worktreeId: 'atlas-id::/ws/atlas/refactor/gh-65-tier-type' } }))
  assert.ok(within(table).getByText('PR 69 open ✓'))

  const summary = within(atlas).getByText('Workspaces (4)')
  fireEvent.click(summary)
  await waitFor(async () => assert.deepEqual((await api.loadView()).expanded, { 'atlas-id': false }))
  assert.equal(table.closest('details')!.open, false)

  const remoteRows = within(within(await projectCard('example-app')).getByRole('table', { hidden: true })).getAllByRole('row', { hidden: true })
  assert.ok(remoteRows.length > 1)
  assert.equal(within(remoteRows[1]).queryByRole('button', { hidden: true }), null, 'a paired server workspace has no Open in its row')
})

test('follows each new snapshot the main process sends', async () => {
  let push: (s: Snapshot) => void = () => undefined
  const api = { ...fakeApi(quietSnapshot()), onSnapshot: (listener: (s: Snapshot) => void) => ((push = listener), () => undefined) }
  render(<App api={api} />)
  assert.ok(within(await screen.findByRole('banner')).getByText('all clear'))
  act(() => push(busySnapshot()))
  assert.ok(within(screen.getByRole('banner')).getByText('4 need you'))
})

/** fakeApi, but `channel` fails with `error`. */
function failing(channel: string, error: string, api: OverviewApi = fakeApi()): OverviewApi {
  const request = api.request as (c: string, i?: unknown) => Promise<unknown>
  return { ...api, request: ((c: string, i?: unknown) => (c === channel ? Promise.reject(new Error(error)) : request(c, i))) as OverviewApi['request'] }
}

test('a ticket that could not be sent stays in its input', async () => {
  render(<App api={failing('overview.runSkill', 'No idle session')} />)
  const atlas = await projectCard('atlas')
  await press(within(atlas).getByRole('button', { name: 'Write ticket' }))
  const input = within(atlas).getByRole('textbox', { name: 'Describe the new ticket for atlas' }) as HTMLInputElement
  fireEvent.change(input, { target: { value: 'Add dark mode' } })
  fireEvent.submit(input)
  assert.match((await screen.findByRole('alert')).textContent!, /write-ticket: No idle session/)
  assert.equal((within(atlas).getByRole('textbox') as HTMLInputElement).value, 'Add dark mode')
})

test('one reply or ticket input is open at a time', async () => {
  render(<App api={fakeApi()} />)
  const blocked = await card('refactor/gh-65-tier-type')
  await press(within(blocked).getByRole('button', { name: 'Reply' }))
  assert.equal(screen.getAllByRole('textbox').length, 1)
  await press(within(await projectCard('beacon')).getByRole('button', { name: 'Write ticket' }))
  assert.deepEqual(screen.getAllByRole('textbox').map((t) => t.getAttribute('aria-label')), ['Describe the new ticket for beacon'])
})

test('a pin made before the saved view state arrives is kept', async () => {
  let arrive: (v: ViewState) => void = () => undefined
  const api = { ...fakeApi(), loadView: () => new Promise<ViewState>((r) => (arrive = r)) }
  render(<App api={api} />)
  fireEvent.click(within(await projectCard('Quiet')).getByRole('button', { name: 'Pin Quiet' }))
  await act(async () => arrive({ pinned: {}, minimized: { 'atlas-id': true }, expanded: {} }))
  assert.equal(projectNames()[0], 'Quiet')
})

test('says so when Orca has no projects', async () => {
  render(<App api={fakeApi({ projects: [], attention: [], updatedAt: 1, error: null, warnings: [] })} />)
  assert.ok(await screen.findByText('Orca has no workspaces to show.'))
})

test('shows why the first snapshot could not be read', async () => {
  render(<App api={failing('overview.snapshot', 'orca: command not found')} />)
  assert.match((await screen.findByRole('alert')).textContent!, /orca: command not found/)
})
