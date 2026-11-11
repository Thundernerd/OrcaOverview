// The engine's notifications as macOS notifications: clicking one shows the window on its item.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { desktopNotifier } from './notify.ts'

/** Stands in for Electron's Notification: records what was shown and lets the test click it. */
function fakeNotifications() {
  const shown: { title: string; body: string; click(): void }[] = []
  const revealed: (string | null)[] = []
  const notify = desktopNotifier({
    create: ({ title, body }) => {
      const n = Object.assign(new EventEmitter(), { show: () => void shown.push({ title, body, click: () => n.emit('click') }) })
      return n
    },
    reveal: (worktreeId) => void revealed.push(worktreeId)
  })
  return { notify, shown, revealed }
}

test('a notification shows its title and body, and clicking it reveals its workspace', async () => {
  const { notify, shown, revealed } = fakeNotifications()
  await notify('atlas · feat-a', 'Marked unread', 'atlas-id::/ws/atlas/feat-a')
  await notify('atlas · feat-b', 'PR #7 CI failing', 'atlas-id::/ws/atlas/feat-b')
  assert.deepEqual(
    shown.map(({ title, body }) => ({ title, body })),
    [
      { title: 'atlas · feat-a', body: 'Marked unread' },
      { title: 'atlas · feat-b', body: 'PR #7 CI failing' }
    ]
  )
  assert.deepEqual(revealed, [])

  shown[1].click()
  assert.deepEqual(revealed, ['atlas-id::/ws/atlas/feat-b'])
})

test('clicking the summary of further items shows the window without a workspace', async () => {
  const { notify, shown, revealed } = fakeNotifications()
  await notify('Orca Overview', '2 more things need you.')
  shown[0].click()
  assert.deepEqual(revealed, [null])
})
