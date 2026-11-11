// The desktop app's main process: runs the shared engine (core/engine.ts), shows the needs-you
// count in the menu bar and answers the window over IPC with the plugin's operation names.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, Tray } from 'electron'
import { join } from 'node:path'
import { ORCA, orcaJsonAt, surveyAvailable, surveyTickets } from '../../../core/cli.ts'
import { createEngine } from '../../../core/engine.ts'
import type { Snapshot } from '../../../core/protocol.ts'
import { handleRequests, handleViewState } from './ipc.ts'
import { requestLocalNetworkAccess } from './localNetwork.ts'
import { desktopNotifier } from './notify.ts'
import { cliOpener } from './opener.ts'
import { fileStorage } from './storage.ts'

/** Orca's events don't reach apps outside it, so poll more often than the plugin's 15 s. */
const POLL_MS = 5_000

// ORCA_OVERVIEW_CLI points the app at another `orca` binary; the smoke test passes a fake one.
const orcaJson = orcaJsonAt(process.env.ORCA_OVERVIEW_CLI || ORCA)

let tray: Tray | null = null
let win: BrowserWindow | null = null
let quitting = false

/**
 * The engine's storage (ticket counts, hidden projects, notified items) and the window's view
 * state, in ~/Library/Application Support/Orca Overview/settings.json.
 */
const storage = fileStorage(join(app.getPath('userData'), 'settings.json'))

const notify = desktopNotifier({
  create: (options) => new Notification(options),
  reveal: revealInWindow
})

const engine = createEngine({
  storage,
  notify: async (title, body, worktreeId) => {
    // Printed like the menu bar count, so the smoke test can see what was announced.
    console.log(`notification: ${title}`)
    if (Notification.isSupported()) await notify(title, body, worktreeId)
  },
  opener: cliOpener(orcaJson),
  // No focusedTerminals or focusedWorkspace: the CLI can't say which workspace Orca's window shows
  // (#14), so with paired servers this machine's active workspace stays the active one.
  // Upstream request: https://github.com/stablyai/orca/issues/41184
  pollMs: POLL_MS,
  log: (message) => console.error(message),
  cli: { orcaJson, surveyTickets, surveyAvailable }
})

let shownTitle: string | null = null

function setMenuBarTitle(title: string): void {
  tray?.setTitle(title)
  if (title === shownTitle) return
  shownTitle = title
  // Printed so a launch from a terminal (and the smoke test) can see the count.
  console.log(`menu bar: ${title}`)
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    // Wide enough for the projects grid beside the Needs you column; narrower than 760px the
    // window falls back to one column, so it can still be made small.
    width: 1200,
    height: 800,
    minWidth: 380,
    show: false,
    title: 'Orca Overview',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), sandbox: true }
  })
  // Closing hides the window; the app keeps running in the menu bar until Quit.
  w.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    w.hide()
  })
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void w.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return w
}

function showWindow(): void {
  win ??= createWindow()
  win.show()
  // Without a Dock icon the app doesn't come forward on its own; bring it in front of Orca.
  app.focus({ steal: true })
  win.focus()
}

/**
 * Shows the window, and asks it to show `worktreeId`'s item once its page has loaded: the window
 * scrolls to that card in Needs you, highlights it and focuses it.
 */
function revealInWindow(worktreeId: string | null): void {
  showWindow()
  if (!worktreeId || !win) return
  const contents = win.webContents
  const send = () => contents.send('overview.reveal', worktreeId)
  if (contents.isLoading()) contents.once('did-finish-load', send)
  else send()
}

/** Hides the window when it's in front; otherwise shows it, also when it's behind other windows. */
function toggleWindow(): void {
  if (win?.isVisible() && win.isFocused()) win.hide()
  else showWindow()
}

app.on('before-quit', () => {
  quitting = true
  engine.stop()
})
// Keep running with the window closed: the menu bar item is the app.
app.on('window-all-closed', () => undefined)

// One copy at a time: a second launch shows the first one's window and quits.
if (!app.requestSingleInstanceLock()) app.quit()
else void app.whenReady().then(start)

app.on('second-instance', showWindow)
// Opening the app again while it runs (Finder, Spotlight, `open`) shows the window.
app.on('activate', showWindow)

function start(): void {
  app.dock?.hide()
  tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('Orca Overview')
  setMenuBarTitle('…')
  const menu = Menu.buildFromTemplate([
    { label: 'Open', click: showWindow },
    { label: 'Refresh', click: () => void engine.refresh() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
  tray.on('click', toggleWindow)
  tray.on('right-click', () => tray?.popUpContextMenu(menu))

  handleRequests(ipcMain, engine)
  handleViewState(ipcMain, storage)
  engine.onSnapshot((s: Snapshot) => {
    setMenuBarTitle(String(s.attention.length))
    if (win && !win.isDestroyed()) win.webContents.send('overview.snapshot', s)
  })
  engine.start()
  void requestLocalNetworkAccess(orcaJson)
  // Show the window at launch, so opening the app visibly does something.
  showWindow()
}
