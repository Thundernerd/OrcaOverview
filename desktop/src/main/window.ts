// The app's one window and its Dock icon: the app is in the Dock, and so in Cmd-Tab, while the
// window is open, and only in the menu bar once it's closed. Info.plist's LSUIElement starts the
// app without a Dock icon, so the icon appears once, when the window first shows, and never
// flashes at launch.

/** Electron's BrowserWindow, as far as this file uses it. */
export interface WindowLike {
  show(): void
  hide(): void
  focus(): void
  restore(): void
  isMinimized(): boolean
  isVisible(): boolean
  isFocused(): boolean
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): unknown
  webContents: {
    isLoading(): boolean
    once(event: 'did-finish-load', listener: () => void): unknown
    send(channel: 'overview.reveal', worktreeId: string): void
  }
}

/** `app.dock`: showing it makes the app a regular app, with a Dock icon and a Cmd-Tab entry. */
export interface DockLike {
  show(): unknown
  hide(): void
}

export interface AppWindowDeps<W extends WindowLike> {
  /** Makes the window, the first time it's shown. */
  create(): W
  /** `app.dock`; undefined off macOS. */
  dock: DockLike | undefined
  /** Brings the app in front of the app the user is in. */
  focusApp(): void
  /** True once the app is quitting: then closing the window really closes it. */
  quitting(): boolean
}

export interface AppWindow<W extends WindowLike> {
  /** The window, once it has been shown; null before. */
  current(): W | null
  /** Shows the window in front, and the Dock icon with it. */
  show(): void
  /** Hides the window and the Dock icon when the window is in front; otherwise shows them. */
  toggle(): void
  /**
   * Shows the window, and asks it to show `worktreeId`'s item once its page has loaded: the window
   * scrolls to that card in Needs you, highlights it and focuses it. Null just shows the window.
   */
  reveal(worktreeId: string | null): void
}

export function appWindow<W extends WindowLike>(deps: AppWindowDeps<W>): AppWindow<W> {
  let win: W | null = null

  function hide(w: WindowLike): void {
    w.hide()
    deps.dock?.hide()
  }

  function create(): W {
    const w = deps.create()
    // Closing hides the window; the app keeps running in the menu bar until Quit.
    w.on('close', (event) => {
      if (deps.quitting()) return
      event.preventDefault()
      hide(w)
    })
    return w
  }

  function show(): void {
    win ??= create()
    deps.dock?.show()
    // Minimized, the window is still open (and the app still in the Dock); bring it back up.
    if (win.isMinimized()) win.restore()
    win.show()
    deps.focusApp()
    win.focus()
  }

  return {
    current: () => win,
    show,
    toggle() {
      if (win?.isVisible() && win.isFocused()) hide(win)
      else show()
    },
    reveal(worktreeId) {
      show()
      if (!worktreeId || !win) return
      const contents = win.webContents
      const send = () => contents.send('overview.reveal', worktreeId)
      if (contents.isLoading()) contents.once('did-finish-load', send)
      else send()
    }
  }
}
