// The window and the Dock icon: the app is in the Dock (and in Cmd-Tab) while its window is open.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { appWindow } from './window.ts'

/** Stands in for the BrowserWindow and `app.dock`: tracks what is on screen and lets the test click. */
function fakeApp() {
  const screen = { window: false, minimized: false, focused: false, dock: false, created: 0, appFocused: 0 }
  let quitting = false
  /** The page in the window: `loading` until the test fires 'did-finish-load'; records what it's sent. */
  const sent: [string, string][] = []
  const page = Object.assign(new EventEmitter(), {
    loading: false,
    isLoading: () => page.loading,
    send: (channel: string, worktreeId: string) => void sent.push([channel, worktreeId])
  })
  const win = Object.assign(new EventEmitter(), {
    webContents: page,
    show: () => void Object.assign(screen, { window: true }),
    hide: () => void Object.assign(screen, { window: false, focused: false }),
    focus: () => void Object.assign(screen, { focused: true }),
    minimize: () => void Object.assign(screen, { minimized: true, focused: false }),
    restore: () => void Object.assign(screen, { minimized: false }),
    isVisible: () => screen.window && !screen.minimized,
    isFocused: () => screen.focused,
    isMinimized: () => screen.minimized
  })
  /** What clicking the window's close button does: the window decides whether it really closes. */
  const close = () => {
    let prevented = false
    win.emit('close', { preventDefault: () => void (prevented = true) })
    if (!prevented) Object.assign(screen, { window: false, focused: false })
  }
  const mainWindow = appWindow({
    create: () => {
      screen.created++
      return win
    },
    dock: { show: () => void (screen.dock = true), hide: () => void (screen.dock = false) },
    focusApp: () => void screen.appFocused++,
    quitting: () => quitting
  })
  return { mainWindow, screen, win, page, sent, close, quit: () => void (quitting = true) }
}

test('showing the window puts the app in the Dock and brings the window forward', () => {
  const { mainWindow, screen } = fakeApp()
  mainWindow.show()
  assert.equal(screen.window, true)
  assert.equal(screen.dock, true)
  assert.equal(screen.focused, true)
})

test('closing the window hides it and takes the app out of the Dock; the app keeps running', () => {
  const { mainWindow, screen, close } = fakeApp()
  mainWindow.show()
  close()
  assert.equal(screen.window, false)
  assert.equal(screen.dock, false)
})

test('while quitting, closing the window really closes it', () => {
  const { mainWindow, screen, win, close, quit } = fakeApp()
  mainWindow.show()
  let hidden = false
  win.hide = () => void (hidden = true)
  quit()
  close()
  assert.equal(hidden, false, 'not hidden: the close goes ahead')
  assert.equal(screen.window, false)
})

test('clicking the menu bar count with the window in front hides it and takes the app out of the Dock', () => {
  const { mainWindow, screen } = fakeApp()
  mainWindow.show()
  mainWindow.toggle()
  assert.equal(screen.window, false)
  assert.equal(screen.dock, false)
})

test('clicking the menu bar count with the window closed brings it back, Dock icon and all', () => {
  const { mainWindow, screen, close } = fakeApp()
  mainWindow.show()
  close()
  mainWindow.toggle()
  assert.equal(screen.window, true)
  assert.equal(screen.dock, true)
  assert.equal(screen.focused, true)
  assert.equal(screen.created, 1, 'the same window comes back')
})

test('clicking the menu bar count with the window behind other apps brings it forward', () => {
  const { mainWindow, screen } = fakeApp()
  mainWindow.show()
  screen.focused = false
  mainWindow.toggle()
  assert.equal(screen.window, true)
  assert.equal(screen.dock, true)
  assert.equal(screen.focused, true)
  assert.equal(screen.appFocused, 2, 'the app is brought in front of the one the user is in, each time')
})

test('minimizing keeps the app in the Dock, and clicking the Dock icon brings the window back', () => {
  const { mainWindow, screen, win } = fakeApp()
  mainWindow.show()
  win.minimize()
  assert.equal(screen.dock, true, 'still in the Dock: the window is still open')

  mainWindow.show()
  assert.equal(screen.minimized, false)
  assert.equal(screen.focused, true)
})

test('clicking the menu bar count with the window minimized brings it back', () => {
  const { mainWindow, screen, win } = fakeApp()
  mainWindow.show()
  win.minimize()
  mainWindow.toggle()
  assert.equal(screen.minimized, false)
  assert.equal(screen.dock, true)
})

test('a notification click with the window closed shows it, in the Dock, on its item', () => {
  const { mainWindow, screen, sent, close } = fakeApp()
  mainWindow.show()
  close()
  mainWindow.reveal('example-app-id::/ws/example-app/feat-a')
  assert.equal(screen.window, true)
  assert.equal(screen.dock, true)
  assert.equal(screen.focused, true)
  assert.deepEqual(sent, [['overview.reveal', 'example-app-id::/ws/example-app/feat-a']])
})

test('a notification click before the page has loaded shows the item once it has', () => {
  const { mainWindow, page, sent } = fakeApp()
  page.loading = true
  mainWindow.reveal('example-app-id::/ws/example-app/feat-a')
  assert.deepEqual(sent, [])
  page.emit('did-finish-load')
  assert.deepEqual(sent, [['overview.reveal', 'example-app-id::/ws/example-app/feat-a']])
})

test('clicking the summary notification just shows the window', () => {
  const { mainWindow, screen, sent } = fakeApp()
  mainWindow.reveal(null)
  assert.equal(screen.window, true)
  assert.equal(screen.dock, true)
  assert.deepEqual(sent, [])
})
