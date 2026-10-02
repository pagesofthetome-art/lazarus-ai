# Developer Mode Overlay Design

**Status:** Draft for user review  
**Date:** 2026-10-02

## Goal

Make Developer Studio a deliberate, reversible way to edit and preview the Lazarus project from inside the running desktop app. The user should see one Lazarus window throughout the preview. Agent edits must stay in a sandbox until the user applies them.

## User flow

1. In Developer Studio, the user clicks **Start Developer Mode** in the action row below the Developer Studio heading. The ordinary **Build APK** action is not shown in Developer Studio.
2. Lazarus opens a confirmation dialog that explains it will snapshot the project, stop the live app's bundled engine, and open an isolated preview. The user can cancel without changing state.
3. On confirmation, Lazarus resolves the selected Codex project folder. If no folder is selected, the dialog offers a native folder picker for a project folder; it never asks the user to open a source file. In a browser-only preview, the dialog explains that native Developer Mode requires the desktop app and does not try to invoke Tauri commands.
4. Lazarus creates a timestamped backup, extracts a working copy to `.lazarus-sandbox`, and routes Developer agent file operations to that sandbox. It starts a Vite server for the sandbox and shows that app inside the existing Lazarus content area. The Developer Studio header, action row, and prompt composer remain visible and usable around the preview. Vite hot reload reflects sandbox changes as the agent writes them.
5. The left action changes to **Apply changes**. A right-aligned **Discard changes** action ends the session. Both stay visible while the preview is open.
6. **Discard changes** stops the preview server, discards the sandbox, keeps the source project untouched, and returns the existing Lazarus window to its normal Developer Studio view. The original app process remains the host; its bundled engine can resume according to its prior state.
7. **Apply changes** first preserves the pre-session backup, synchronizes sandbox file additions, edits, and deletions into the source project, builds a new Lazarus executable to a staging location, and starts that executable with the same user data. A small relaunch handoff lets the current process exit before the rebuilt app starts, avoiding replacement of a running executable. If synchronization or build fails, the backup is restored and the current app stays available with an error message.

## Architecture

The existing Lazarus Tauri window remains the host; the preview is a sandbox project served locally and rendered in the app's content region, not a second OS window or tab. The preview is therefore visually a second live version of Lazarus while keeping the existing prompt controls available. Apply is the only path that builds and relaunches the executable.

The desktop path uses Tauri commands for native folder selection, backup/restore, sandbox lifecycle, local preview-server lifecycle, and build/relaunch handoff. Commands validate canonical paths and ensure the sandbox remains separate from the source project. The web preview may show the entry explanation but cannot start the native workflow.

Developer turns must use the sandbox as their effective working directory for file reads, writes, and commands. The selected source folder remains recorded separately as the apply target. The original app's bundled engine is stopped only after the snapshot and sandbox are ready; failure before that point leaves the live session running normally.

## Backup and isolation

- Keep timestamped pre-session backups under `.lazarus-backups`, rotating old backups only after a new backup is fully written.
- Keep the working copy under `.lazarus-sandbox`; exclude generated dependencies, build output, Git metadata, backup archives, and sandbox internals from source synchronization.
- Apply must mirror source changes, including deletions, while preserving excluded generated directories in the live project.
- Discard removes only the sandbox. It does not copy sandbox files to the source.
- Preview server output and lifecycle failures must be surfaced in the Developer UI; a failed launch must not leave the controls disabled indefinitely.

## UI details

- Place a larger **Start Developer Mode** button below the Developer Studio title, aligned left in the header area that also contains Developer controls.
- During an active session, that same left action reads **Apply changes**.
- Place **Discard changes** at the right end of the same action row.
- Keep **Ask** in the composer for agent permission behavior; it is independent of starting or ending the preview session.
- Remove **Build APK** from Developer Studio while retaining the existing APK action in the normal Coding Agent view.
- Show clear progress and errors for snapshot, sandbox boot, preview startup, build, restore, and relaunch. Disable only actions that conflict with an in-progress lifecycle step.

## Failure behavior

- Cancel on the confirmation dialog changes nothing.
- Missing workspace opens the folder picker from the same entry flow. Picker cancellation returns to idle without a dead button or partial session.
- Backup, extraction, or preview startup failure cleans up partial state and leaves the source unchanged.
- Apply failure restores the pre-session backup if source synchronization had begun; the user can retry or discard.
- Discard remains available even if the preview server or build process failed.
- The desktop app remains the authority for native operations. Browser preview actions show an explanatory desktop-required message instead of silently doing nothing.

## Acceptance criteria

1. Entering Developer Studio alone does not take a snapshot, start a preview server, or cover the app with a preview.
2. Start Developer Mode presents a confirmation. Confirming creates a backup and an isolated sandbox before showing the live preview.
3. Agent edits in an active Developer session are confined to the sandbox; source files remain unchanged before Apply.
4. The preview is visible in the existing Lazarus window, with the Developer controls and message composer still reachable.
5. Apply updates the source tree including deletions, builds the Lazarus executable, and relaunches the rebuilt app with the existing app data.
6. Discard removes sandbox changes and returns to the unchanged running app without applying them.
7. The web preview explains the desktop requirement, and clicking its Developer action never fails silently.
8. Build APK is absent in Developer Studio and remains available in the normal Coding Agent view.

## Verification plan

Use focused unit coverage for sandbox path validation, snapshot rotation, safe file synchronization including deletion handling, and lifecycle transitions. Use a Tauri desktop smoke test to confirm the confirmation dialog, single-window preview, sandbox routing, apply/rebuild/relaunch path, and discard path. Run the repository's relevant type, lint, and Rust checks after implementation. The browser-only preview should be checked for its explanatory message and for graceful handling when Tauri APIs are unavailable.

## Scope boundary

This design rebuilds and relaunches the executable from the selected Lazarus source project. It does not silently install a package, overwrite an installer, publish a GitHub release, or request administrator privileges. The app's existing user data remains in its normal app-data location.
