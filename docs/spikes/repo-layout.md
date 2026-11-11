# Spike: repo layout for the plugin and the desktop app

Issue: #2. Run on 2026-11-11 with Orca 1.4.253, Node 26.3.0, npm 11.16.0 and Electron 45.3.0 on macOS.

## Decision

Keep the plugin at the repository root. The desktop app goes in `desktop/` next to it:

```text
orca-plugin.json     plugin manifest (unchanged)
src/                 plugin worker and panel
core/                shared, pure code: the plugin and the desktop app import it
desktop/             Electron app, with its own package.json and node_modules
```

- **`core/` must be inside the plugin root.** Panels can import only files inside the plugin folder (see [core/ outside the plugin](#core-outside-the-plugin) below). With the plugin at the root, `src/` imports `../core/…` and `desktop/` imports `../core/…` through its own build.
- **Install from GitHub:** `orca plugin install Thundernerd/OrcaOverview`, or `…@vX.Y.Z` for a release. Orca fetches the repository pinned to one commit, so it gets only committed files. `desktop/node_modules` is ignored by git and never ships.
- **Develop:** `orca plugin check`, `orca plugin test` and `orca plugin validate` keep working from a checkout where `desktop/node_modules` is installed. So do `orca plugin dev load` and `orca plugin dev reload`: a content-only copy loaded and reloaded, and a worker copy reached the approval step. Its approval fingerprint doesn't change when `desktop/node_modules` changes, so an `npm i` there doesn't ask for approval again. No worker copy was approved and run: approving starts its worker on the host, and that is for the person at the machine to decide. Run `orca plugin dev reload .` once in #3, after `desktop/` is installed.

We don't need the `plugin/` subfolder. The root layout passes the commands the issue lists, and moving the plugin to `plugin/` would put `core/` outside the plugin.

## Rules for #3 and later

1. Don't install from a working folder (`orca plugin install .`) when `desktop/node_modules` is installed. It fails on the symlinks in `node_modules`, and it would hit the 50 MiB limit even without them. Install from GitHub, or from a clean `git clone`.
2. Keep `desktop/` build output (for example `desktop/out/`, `desktop/dist/`) and `node_modules/` ignored by git. Every committed file under `desktop/` ships with the plugin and counts toward the plugin limits: "A plugin holds at most 2,000 files and 50 MiB" (Orca's plugin authoring guide, Gotchas).
3. `orca plugin test` runs every `*.test.ts(x)` under the root, `desktop/` included, with `node:test` (or vitest, when the plugin has its own in `node_modules`). It skips only `node_modules`, `.orca`, `dist` and dot-folders. So desktop tests must either run under that runner without Electron or use a name that `orca plugin test` doesn't match.
4. Add `core` to `include` in `tsconfig.json` when `core/` is created. `desktop/` gets its own `tsconfig.json`.
5. With npm 11, `npm i electron` doesn't run Electron's install script, so the binary is missing. Run `node node_modules/electron/install.js` once, or allow the script.

## What Orca does with `desktop/node_modules`

| Command | Counts `desktop/node_modules`? | Result |
| --- | --- | --- |
| `orca plugin validate . --json` | No | ok |
| `orca plugin check . --json` | No | ok |
| `orca plugin test . --json` | Skipped by name | ok |
| `orca plugin dev load` / `dev reload --json` (on copies) | No | ok (content-only copy); approval step, same fingerprint (worker copy) |
| `orca plugin inspect . --json` | Yes, hashes every file | `plugin_invalid` |
| `orca plugin install <folder> --json` | Yes, hashes every file | `plugin_install_failed` |
| Install from a clean clone (committed files only) | Nothing to count | ok |

## Evidence

The throwaway app: `desktop/` with `npm init -y`, `npm i electron`, `node node_modules/electron/install.js` and a two-line `index.js`. `desktop/node_modules` then held 743 files and 17 symlinks, 273 MB. The `.bin` links and the framework links inside `Electron.app` are the symlinks.

Paths below are shortened. `<scratch>` is a temporary folder outside the repository.

### Root layout, from the repository

```console
$ orca plugin validate . --json    # exit 0, "valid": true, "errors": []
$ orca plugin check . --json       # exit 0, panels "busy" and "quiet" render
$ orca plugin test . --json
{"ok":true,"result":{"runner":"node","code":0,"node":"system","files":["src/model.test.ts","src/panel.test.tsx"]}}
```

`inspect` hashes files the same way `install` does:

```console
$ orca plugin inspect . --json     # exit 2
"code":"plugin_invalid" … "errors":["symlink not allowed in plugin content: desktop/node_modules/.bin/electron"]
```

After deleting every symlink in `desktop/node_modules`:

```console
$ orca plugin inspect . --json
"errors":["plugin exceeds the 52428800-byte limit"]
```

With `desktop/node_modules` moved out of the folder:

```console
$ orca plugin inspect . --json
ok: true, fileCount: 29, totalBytes: 170821
```

So `validate`, `check` and `test` never look at `node_modules`, but anything that hashes the folder counts it in full.

A `desktop/smoke.test.ts` is picked up by `orca plugin test`:

```console
$ orca plugin test . --json
"files":["desktop/smoke.test.ts","src/model.test.ts","src/panel.test.tsx"]
```

### Dev load and reload

These ran on copies of the folder under a different plugin id (`layoutspike`), so the loaded Overview plugin was left alone. Both copies held the full `desktop/` with its `node_modules` and symlinks.

A copy of this plugin (a trusted worker) reached the approval step, not `plugin_invalid`:

```console
$ orca plugin dev load <scratch>/root-copy --json    # exit 3
"code":"approval_required" … "Fingerprint: ap1-…"
```

It wasn't approved. Running `dev load` on the worker copy again after each change gave the same fingerprint every time:

```console
with desktop/node_modules           approval_required ap1-2fcc854c…
plus desktop/node_modules/fake-pkg  approval_required ap1-2fcc854c…
without desktop/node_modules        approval_required ap1-2fcc854c…
after editing src/model.ts          approval_required ap1-2fcc854c…
after adding desktop/new-source.ts  approval_required ap1-2fcc854c…
```

So the dev approval covers the manifest's access, not the folder's files. That matches the approval message: "Later code edits in this development folder run without asking again".

A content-only copy (from `orca plugin create --template theme`) needs no approval, so it shows the whole load:

```console
$ orca plugin dev load <scratch>/theme-spike --json   # exit 0
"pluginKey":"local.layoutspike","added":true,"approval":"content-only", "status":"idle"
$ orca plugin dev reload <scratch>/theme-spike --json # exit 0, status "idle", no log lines
$ orca plugin install <scratch>/theme-spike --json    # exit 1
"code":"plugin_install_failed" … "is not an installable plugin: symlink not allowed in plugin content: desktop/node_modules/.bin/electron"
```

Both copies were unloaded afterwards.

### Install from GitHub, simulated

A clean `git clone` of this branch, with `desktop/package.json`, `package-lock.json` and `index.js` committed and nothing installed:

```console
$ orca plugin inspect . --json
ok: true, fileCount: 21, totalBytes: 93125     # 21 = git ls-files
```

`orca plugin install owner/repo` clones a commit the same way, so it sees the same files.

### core/ outside the plugin

The plugin copied to `<scratch>/sub/plugin`, with `<scratch>/sub/core/greeting.ts` next to it, and `src/panel.tsx` importing `../../core/greeting`:

```console
$ orca plugin check . --json    # exit 1
src/panel.tsx: cannot import "../../core/greeting": it is outside the plugin
```

This rules out a `plugin/` folder with `core/` beside it. The `plugin/` layout and `orca plugin install <tree URL ending in /plugin>` weren't tested further, because the root layout passed.
