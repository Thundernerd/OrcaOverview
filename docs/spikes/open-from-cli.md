# Spike: open a local workspace and its agent tab from outside Orca

Issue #1. The desktop app (#5) runs outside Orca, so it can't call the plugin host API that
`openWorkspace` in `src/actions.ts` uses (`workspace.list` + `workspace.open`). Can the `orca`
CLI alone show a local workspace and its agent's tab in Orca's window?

## Answer

| Step | Command | Moves Orca's window? |
| --- | --- | --- |
| 1 | `orca worktree activate --worktree id:<repoId>::<path> --json` | **Yes.** It shows the workspace, but on the tab the workspace last showed, not the agent's tab. |
| 2 | `orca terminal switch --terminal <handle> --json` | **Yes.** It shows the agent's tab. |
| 2 alone | `orca terminal switch` from another workspace, no step 1 | **Yes.** It opens the workspace and the agent's tab in one call (`"navigated": true`). |

The desktop app can open a local workspace on its agent's tab with one call:
`orca terminal switch --terminal <handle>`. It finds the handle the way `src/actions.ts` does: from
`terminal list`, the terminal whose `tabId:leafId` matches the agent's `paneKey` in `worktree ps`.
If the workspace has no agent terminal, `orca worktree activate` still opens the workspace.

Activate alone does **not** show the agent's tab when the workspace was last left on a different
tab. It only looks that way when the agent's tab was already the workspace's current tab.

## Setup

- Orca 1.4.253 on macOS. Paired-server workspaces are out of scope (stablyai/orca#31073).
- Every command ran from a shell started with `env -i HOME=$HOME PATH=/usr/bin:/bin`, from `/`.
  That shell had no `ORCA_*` variables, so the CLI had no idea which terminal or workspace it was
  called from, just like a process outside Orca.
- Target: a local workspace `example-app` (the main checkout) with one Claude agent tab. A second
  shell tab, `spike-shell`, was added to it and made its current tab before the test. Then Orca was
  moved to another local workspace (`feat-gh-7-sign-in`). Without the second tab, step 1 couldn't
  tell "activate shows the agent tab" apart from "activate shows the last tab".
- The window is moved for real: each step changes what Orca shows.

### Checking the result

- **Workspace:** `orca worktree ps --json` gives `isActive` for each workspace.
- **Tab:** the CLI has no "current tab" field: `terminal list` and `terminal show` look the same
  whichever tab is shown, and `terminal show` without `--terminal` doesn't return the shown tab
  either. So the tab was read from Orca's saved window state:

  ```sh
  sqlite3 -readonly "$HOME/Library/Application Support/orca/profiles/local-default/profile-state.db" \
    "select payload from profile_state_documents where domain='workspaceSession'" |
    jq -c --arg t "$TARGET" '{activeWorktreeId, activeTabId, targetActiveTab: .activeTabIdByWorktree[$t]}'
  ```

  Orca writes it within a second or two of a change, and its tab ids match the `tabId` from
  `terminal list`. It is internal state, not a supported API: good enough for this spike, but the
  desktop app shouldn't depend on it.

`orca computer get-app-state` (Orca's accessibility snapshot) would have been a second check, but
it needs the Accessibility permission, which wasn't granted.

## Run

Ids, handles and paths below are made up but consistent: the same value stands for the same thing
throughout. Each JSON answer is shown in full, except the request `id` and `_meta.runtimeId`.

```sh
ORCA=/Applications/Orca.app/Contents/Resources/bin/orca
TARGET='7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35::/Users/dev/src/example-app'
OTHER='7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35::/Users/dev/orca/workspaces/example-app/feat-gh-7-sign-in'
```

| Name in the output | Value |
| --- | --- |
| Agent terminal (`paneKey` `1b6f0c3a-…:6d2a8e41-…`) | `term_5a1e6c2b-8f3d-4e71-b0a9-3c6d2e8f1a47`, tab `1b6f0c3a-2e94-4d58-a7c1-9e0b5d3f2a68` |
| `spike-shell` terminal | `term_c49d2e7f-1a6b-4c38-9e05-7b2f8a1d3c64`, tab `9e7c1d04-3b5a-4f26-8d19-6a0e2c4b8f73` |
| `OTHER`'s current tab | `0c5e9b27-6d1f-4a83-b2e4-8f7a3c1d6e90` |

### Before: Orca shows `OTHER`, and the target was left on `spike-shell`

```sh
$ORCA worktree ps --json | jq -c --arg t "$TARGET" '[.result.worktrees[] | select(.worktreeId == $t or .isActive) | {worktreeId, isActive}]'
```

```json
[{"worktreeId":"7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35::/Users/dev/src/example-app","isActive":false},
 {"worktreeId":"7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35::/Users/dev/orca/workspaces/example-app/feat-gh-7-sign-in","isActive":true}]
```

Saved window state:

```json
{"activeWorktreeId":"7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35::/Users/dev/orca/workspaces/example-app/feat-gh-7-sign-in",
 "activeTabId":"0c5e9b27-6d1f-4a83-b2e4-8f7a3c1d6e90",
 "targetActiveTab":"9e7c1d04-3b5a-4f26-8d19-6a0e2c4b8f73"}
```

### Step 1: `worktree activate` (yes: it opens the workspace, but not on the agent's tab)

```sh
$ORCA worktree activate --worktree "id:$TARGET" --json
```

```json
{
  "ok": true,
  "result": {
    "repoId": "7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35",
    "worktreeId": "7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35::/Users/dev/src/example-app",
    "activated": true,
    "sleepingAgentWake": "not-applicable"
  }
}
```

`worktree ps` afterwards: the target is the active workspace.

```json
[{"worktreeId":"7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35::/Users/dev/src/example-app","isActive":true}]
```

Saved window state: the target is shown, on `spike-shell` (`9e7c…`), not on the agent's tab.

```json
{"activeWorktreeId":"7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35::/Users/dev/src/example-app",
 "activeTabId":"9e7c1d04-3b5a-4f26-8d19-6a0e2c4b8f73",
 "targetActiveTab":"9e7c1d04-3b5a-4f26-8d19-6a0e2c4b8f73"}
```

### Step 2: `terminal switch` (yes: it shows the agent's tab)

The handle came from `terminal list --worktree "id:$TARGET" --json`: the terminal whose
`tabId:leafId` is the agent's `paneKey` from `worktree ps`.

```sh
$ORCA terminal switch --terminal term_5a1e6c2b-8f3d-4e71-b0a9-3c6d2e8f1a47 --json
```

```json
{
  "ok": true,
  "result": {
    "focus": {
      "handle": "term_5a1e6c2b-8f3d-4e71-b0a9-3c6d2e8f1a47",
      "tabId": "1b6f0c3a-2e94-4d58-a7c1-9e0b5d3f2a68",
      "worktreeId": "7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35::/Users/dev/src/example-app",
      "navigated": true
    }
  }
}
```

`worktree ps`: the target is still active.

```json
[{"worktreeId":"7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35::/Users/dev/src/example-app","isActive":true}]
```

Saved window state: the agent's tab (`1b6f…`) is shown.

```json
{"activeWorktreeId":"7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35::/Users/dev/src/example-app",
 "activeTabId":"1b6f0c3a-2e94-4d58-a7c1-9e0b5d3f2a68",
 "targetActiveTab":"1b6f0c3a-2e94-4d58-a7c1-9e0b5d3f2a68"}
```

`terminal show --terminal term_5a1e… --json` returns the same fields whether its tab is shown or
not (handle, `tabId`, `leafId`, `title`, `connected`, `agentIdentity: "claude"`, a preview of
the output). Nothing in it says the tab is shown.

### Step 2 alone: `terminal switch` from another workspace (yes: workspace and tab in one call)

`spike-shell` was closed (`terminal close --terminal term_c49d… --tab --json`) and Orca was moved
back to `OTHER` with `worktree activate --worktree "id:$OTHER"`:

```json
[{"worktreeId":"7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35::/Users/dev/src/example-app","isActive":false},
 {"worktreeId":"7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35::/Users/dev/orca/workspaces/example-app/feat-gh-7-sign-in","isActive":true}]
```

```json
{"activeWorktreeId":"7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35::/Users/dev/orca/workspaces/example-app/feat-gh-7-sign-in",
 "activeTabId":"0c5e9b27-6d1f-4a83-b2e4-8f7a3c1d6e90",
 "targetActiveTab":"1b6f0c3a-2e94-4d58-a7c1-9e0b5d3f2a68"}
```

Then, with no `worktree activate`:

```sh
$ORCA terminal switch --terminal term_5a1e6c2b-8f3d-4e71-b0a9-3c6d2e8f1a47 --json
```

```json
{
  "ok": true,
  "result": {
    "focus": {
      "handle": "term_5a1e6c2b-8f3d-4e71-b0a9-3c6d2e8f1a47",
      "tabId": "1b6f0c3a-2e94-4d58-a7c1-9e0b5d3f2a68",
      "worktreeId": "7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35::/Users/dev/src/example-app",
      "navigated": true
    }
  }
}
```

```json
[{"worktreeId":"7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35::/Users/dev/src/example-app","isActive":true}]
```

```json
{"activeWorktreeId":"7c3e9a10-5b2d-4f8e-9a61-2d4c8b0e1f35::/Users/dev/src/example-app",
 "activeTabId":"1b6f0c3a-2e94-4d58-a7c1-9e0b5d3f2a68",
 "targetActiveTab":"1b6f0c3a-2e94-4d58-a7c1-9e0b5d3f2a68"}
```

## For the desktop app

- **Open on the agent's tab:** `orca terminal switch --terminal <handle> --json`. Find the handle as
  `handleFor` in `src/actions.ts` does. Pick the agent as `agentsByUrgency` does.
- **No agent terminal** (no agents, or no `paneKey` match): `orca worktree activate --worktree
  id:<worktreeId> --json` opens the workspace on its last tab. This is the fallback.
- **Paired servers:** out of scope. Leave Open disabled, as the plugin does.
- **Caveat:** these commands ran from a stripped shell inside an Orca terminal, not from a
  process that launchd started. The CLI reaches Orca through its local socket either way, and no
  `ORCA_*` variables were set, so a separate app should get the same results. #5 is the first
  real test of that.
