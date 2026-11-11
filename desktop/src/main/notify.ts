// The engine's notifications as macOS notifications. Clicking one shows the window on its item.
import type { EngineDeps } from '../../../core/engine.ts'

/** Electron's Notification, as far as this file uses it. */
export interface NotificationLike {
  on(event: 'click' | 'close', listener: () => void): unknown
  show(): void
}

/** What the notifier needs from the app: a way to make a notification and to show its item. */
export interface NotifierDeps {
  /** Makes a notification; the app passes `new Notification(options)`, tests a fake. */
  create(options: { title: string; body: string }): NotificationLike
  /** Shows the window on `worktreeId`'s item, or just the window for a summary. */
  reveal(worktreeId: string | null): void
}

/** The engine's `notify`, showing each notification and routing its click through `reveal`. */
export function desktopNotifier(deps: NotifierDeps): EngineDeps['notify'] {
  // Electron drops a notification's click once nothing refers to it, so keep each one until it
  // is clicked or closed.
  const live = new Set<NotificationLike>()
  return async (title, body, worktreeId) => {
    const n = deps.create({ title, body })
    live.add(n)
    n.on('click', () => {
      live.delete(n)
      deps.reveal(worktreeId ?? null)
    })
    n.on('close', () => void live.delete(n))
    n.show()
  }
}
