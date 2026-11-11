# Orca Overview

An [Orca](https://onorca.dev) plugin: one sidebar panel for every project and its ticket workspaces. It puts what needs you first and gives one-click access to the ticket skills (`/launch-tickets`, `/merge-tickets`, `/clean-workspaces`, `/write-ticket`).

## What it shows

### Needs you

One list across all projects, with one card per workspace:

- **Order:** blocked or waiting agents and failing CI come first, then PRs ready to merge, then workspaces flagged unread or with a `blocked: …` comment. Within each group, what has waited longest is on top.
- **Actions:** Open (goes straight to the agent's tab), Open main, Reply (the text goes to the agent's terminal), Mark read and Merge tickets.
- **During a merge:** while `/merge-tickets` runs in a project, its "Ready to merge" items are hidden. The run is already working through them.

### Projects

One card per repository, showing:

- what needs you, agents working, open PRs, tickets ready to launch, and merged workspaces to clean up
- buttons for the four skills
- a table of the project's workspaces

You can:

- **Minimize** a card down to its header and badges.
- **Pin** a card to keep it at the top.
- **Hide** a project. Hidden projects stay out of "Needs you" and out of the counts.

The project you're working in is highlighted.

### Paired servers

Workspaces on paired Orca servers (`orca environment`) show up as their own projects, marked with the server's name. Reply, Mark read and the skill buttons work on them. Open is disabled, because Orca can't yet show a paired server's workspace in this window from a plugin ([stablyai/orca#31073](https://github.com/stablyai/orca/issues/31073), [#40723](https://github.com/stablyai/orca/issues/40723)).

### Status bar

Shows "N need you". Clicking it opens the oldest item that needs you. You also get a desktop notification when something new needs you.

## How it works

- **Polling:** the engine (`core/engine.ts`) reads `orca worktree ps --json` every 15 s, and the plugin's worker (`src/worker.ts`) asks it to refresh right away on workspace and agent events. It also reads each paired server that `ps` lists as omitted, using `--environment`. It uses the CLI because Orca's plugin host API only sees the focused workspace.
- **Ticket counts:** these come from `~/.claude/skills/launch-tickets/scripts/survey.sh`.
  - It runs in each project's main workspace every 5 minutes, or when you press ↻ on the card. It needs `gh`, `jq` and `git`, and it runs `git fetch`.
  - A project on a paired server shows the counts of your local checkout of the same repository.
- **Skill buttons:** a button types `/<skill>` into an idle Claude session in the project's main workspace. If there isn't one, it starts a new session with `orca agent launch`.
- **Rules:** `core/model.ts` is pure and holds every rule (what needs you, merging, projects, active workspace). See `core/model.test.ts`.
- **Shared core:** `core/` holds what the plugin and the desktop app (`desktop/`) share: the engine, the rules, the ticket survey parser, the `orca` CLI calls (`core/cli.ts`, `core/actions.ts`), the snapshot types and the request names (`core/protocol.ts`). The engine (`core/engine.ts`) does the polling, the ticket survey schedule, pending merges and notifications. It doesn't use Orca's plugin API: the plugin's worker passes it storage, notifications, the focused workspace's terminals and an opener (`src/opener.ts`) built on that API, and shows each snapshot in the panel and the status bar. `src/` holds the plugin's worker and panel.
- **Self-contained core:** nothing in `core/` imports `orca`. Its tests use `node:test`, and `core/node.d.ts` declares the few Node APIs it needs, so it type-checks without `@types/node`. A build that brings `@types/node` excludes `core/node.d.ts`. `core/tsconfig.json` doesn't depend on Orca's generated types, so the desktop app builds from a fresh clone.

## Requirements

- Orca 1.4.248 or later. The worker runs as a trusted worker, so Orca asks you to approve it.
- The ticket skills in `~/.claude/skills` for the ticket counts and buttons. Without them the rest of the panel still works.

## Develop

```sh
ORCA=/Applications/Orca.app/Contents/Resources/bin/orca
$ORCA plugin types .          # writes the typings that tsconfig.json extends (once per checkout)
$ORCA plugin test .           # unit and panel tests
$ORCA plugin check . --json   # renders the src/panel.check.ts scenarios
$ORCA plugin dev reload .     # load into Orca (asks for approval the first time)
$ORCA plugin dev request . overview.snapshot --json
npx -p typescript tsc -p . --noEmit
node --test 'core/*.test.ts'  # core's tests, without Orca
npx -p typescript tsc -p core --noEmit  # core alone, without .orca/types
```

## Desktop app

`desktop/` is a macOS menu bar app that shows the overview outside Orca. The menu bar shows how many items need you (the same count as the plugin's status bar). Its window does everything the panel does: Needs you, the project cards and their buttons, pin, minimize and hide. It follows macOS light and dark mode.

- **Engine:** the main process runs the same engine as the plugin. Orca's events don't reach apps outside it, so it polls every 5 s.
- **Requests:** the window asks the main process over IPC, with the plugin's request names (`overview.snapshot`, `overview.runSkill`, …).
- **Saved settings:** pins, minimized and hidden projects, the open workspace tables, ticket counts and what you've been notified about are saved in `~/Library/Application Support/Orca Overview/settings.json`. They survive a restart, and the counts show right away. A missing or unreadable file starts the app with nothing saved.
- **Notifications:** something new that needs you shows a macOS notification, like the plugin's. A restart doesn't announce what you were already told about. Clicking a notification brings the window forward.
- **Menu bar:** the window opens when you start the app. Click the count to bring the window forward, or to hide it when it's already in front. Right-click for Open, Refresh and Quit. Closing the window keeps the app running. It has no Dock icon.
- **Opening workspaces:** it uses `orca worktree activate` and `orca terminal switch`, since it can't use the plugin API.
- **Active project with paired servers:** each paired server reports its own last-focused workspace as active. The plugin keeps the one Orca's window shows, through the plugin API. The `orca` CLI can't tell which workspace the window shows (`--worktree active` means the current directory's workspace), so the app keeps this machine's active workspace. While you look at a paired server's workspace in Orca, the app highlights a different project and workspace than the plugin. The needs-you count isn't affected. The engine already accepts the shown workspace as `focusedWorkspace`, for when the CLI can report it ([stablyai/orca#41184](https://github.com/stablyai/orca/issues/41184)).

It needs Node and npm. Run these in `desktop/`:

```sh
npm install
node node_modules/electron/install.js   # npm 11 skips Electron's install script
npm run dev         # run it from source, with live reload
npm run build       # an unsigned app in dist/mac-<arch>/Orca Overview.app
npm test            # unit tests, and the window's component tests (*.spec.tsx)
npm run smoke       # launches the built app against a fake orca CLI, with its own user-data folder
npm run typecheck
```

The build is only ad-hoc signed. If macOS refuses to open it, right-click the app and choose Open. To read paired servers on your network, the app needs Local Network access. At launch it connects to each paired server once so macOS asks: allow it, or turn on Orca Overview later under System Settings → Privacy & Security → Local Network. The build gives the executable its own Mach-O UUID (`desktop/build/unique-uuid.cjs`); without that, macOS takes the app for the stock Electron and blocks it without asking. Without it those servers show "Could not connect to the remote Orca runtime". `ORCA_OVERVIEW_CLI=/path/to/orca` points the app at a different `orca` binary.

`orca plugin test` runs the desktop's `*.test.ts` files too, but not the window's `*.spec.tsx` component tests: it compiles JSX for Orca's panels, not for React. Run those with `npm test`.

Don't install the plugin from a checkout that has `desktop/node_modules` (`orca plugin install .`). Install it from GitHub or from a clean clone (see `docs/spikes/repo-layout.md`).

## License

[MIT](LICENSE)
