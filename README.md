# PathSeek

[**English**](README.md) | [简体中文](README.zh-CN.md)

**PathSeek** is an open-source macOS file-search extension for Raycast, inspired by the fast file navigation workflow of Windows Listary.

> **Early development / local testing only.** Persistent indexing, fuzzy search and Finder actions have initial implementations but have passed development CI and partial user macOS testing, but still need full regression verification. Returning a result to an existing application's Open/Save dialog is a planned feature, **not implemented**.

## Features

- **Strictly manual indexing** — Nothing is indexed on install or when opening Search Files. Choose folders on your first Rebuild Index; only an explicit Build / Rebuild action runs fd. Index remains reusable until you manually rebuild.
- **One fzf search** — `Search Files` uses fzf extended matching against filenames and full paths. Supports fuzzy terms, exact terms, suffix/prefix matching, negation, and OR. Typing never invokes fd.
- **Native Finder file icons and actions** — Folder icons and actual file-type icons; Open, Show in Finder, Open Containing Folder, Open With, Quick Look and Copy Absolute Path.
- **Index Status** — See index metadata, open its actual support directory in Finder, and copy the full directory path.
- **Debug Info** — Copy a privacy-safe diagnostics report with macOS, Raycast, Node.js and index-file consistency checks for GitHub Issues.
- **Configurable scope** — Choose multiple roots, hidden files, symlink traversal, and excluded globs.
- **Future** — Navigate a pre-existing macOS Open/Save file picker directly from Raycast results (Dialog Bridge, not yet available).

## Requirements

- macOS, with Raycast installed and signed in.
- Node.js **22.14+**, npm **7+**, and Git.
- `fd` and `fzf` installed locally, e.g. `brew install fd fzf`. You may configure executable paths in the PathSeek extension preferences.

## Install for local development

```bash
git clone https://github.com/juezhong/raycast-pathseek.git
cd raycast-pathseek
brew install fd fzf
npm install
npm run dev
```

`npm run dev` imports the local extension into Raycast and starts development mode. From Raycast, run:

1. **Index Status** — inspect the current index and find the exact on-disk storage location (without scanning).
2. **Rebuild Index** — on first use, choose one or more folders with Raycast's directory picker, then explicitly select **Choose Folders and Build Index**. On later visits, use **Cmd+K → Change Indexed Folders** or **Rebuild Index Now**.
3. **Search Files** — type a filename, folder name or part of a path; select a result and use its actions.
4. **Debug Info** — if a test fails, copy the sanitized report into [Issue #1](https://github.com/juezhong/raycast-pathseek/issues/1).

**No automatic indexing, ever.** Install, extension startup, Search Files and Index Status never run fd. A stale or missing index stays unchanged until you manually select Rebuild Index. Saving different folders does not scan or replace an existing index.

### Preferences

| Preference | Meaning | Example |
| --- | --- | --- |
| Indexed Folders | Choose one or more folders from **Rebuild Index**. The selection is stored locally with Raycast LocalStorage. | Finder-style folder picker |
| Include Hidden Files | Whether `fd` includes hidden entries when rebuilding | Off by default |
| Follow Symbolic Links | Whether `fd` follows directory symlinks | Off by default |
| Exclude Patterns | Comma-separated `fd --exclude` globs | `.git,node_modules` |
| fd Executable / fzf Executable | Optional absolute paths if auto-detection fails | `/opt/homebrew/bin/fd` |

Changing scan preferences **does not update the index** until you explicitly use `Rebuild Index`.

## Where is the index stored?

PathSeek uses Raycast's official `environment.supportPath` directory, not the cloned Git repository and not Raycast's encrypted LocalStorage database. **The actual absolute path is determined by Raycast at runtime**, so do not assume a fixed `~/Library/...` path.

Run **Index Status → Open Index Directory in Finder** (or **Copy Index Directory Path**) to inspect the exact location:

```text
<environment.supportPath>/
├── index.nul             # Active index: embedded metadata + NUL-separated paths
├── index-<UUID>.nul.tmp  # Staged index before atomic replacement
├── index.json            # Legacy v1 metadata only; no longer authoritative
└── index-<UUID>.nul      # Migration-only legacy generations retained temporarily
```

The index may contain private file names and paths; do not upload it to public GitHub Issues. The active v2 index is self-contained: metadata and paths are published in a single atomic rename, rather than separate data and JSON commits. Writer locks prevent redundant overlapping builds; legacy v1 files are retained briefly for migration. See [Index Storage & Maintenance (中文)](docs/index-storage.md) for the file format, update/rollback strategy and read-only inspection commands.

### Search modes

Search results are strictly capped at **150**. Developer tracing reports a deliberate early fzf stop as `limit-reached` (exit code may be `null`), which is not an error.

There is only **one Search Files mode**, powered by fzf. Its built-in extended-search syntax supports `report` (fuzzy), `'report` (exact substring), `.pdf$` (suffix), `!node_modules` (exclude), and `.ts$ | .tsx$` (OR). These are **fzf operators, not regular expressions**. Searches match indexed paths, not file contents. See the [fzf search syntax guide](https://junegunn.github.io/fzf/search-syntax/).

## Documentation

| Document | Purpose |
| --- | --- |
| [Architecture (中文)](docs/architecture.md) | Module map, control/data flow and trade-offs |
| [Index Storage (中文)](docs/index-storage.md) | Exact location discovery, index formats, build/search behavior |
| [Development & Testing (中文)](docs/development.md) | Load in Raycast, configure, test and troubleshoot |
| [Development Plan (中文)](plans/pathseek-development/task_plan.md) | Phases, acceptance criteria and next step |
| [中文 README](README.zh-CN.md) | Complete Chinese user guide |

### Opt-in developer execution trace

PathSeek has a disabled-by-default **Developer: Trace fd/fzf Calls** preference. With it enabled, **Debug Info** shows sanitized fd/fzf subprocess start/end records, invocation flags, trigger reasons (manual rebuild, fuzzy query), durations, results and exit codes. Search terms and personal paths are never persisted in this trace. Turning it off prevents trace disk writes during ordinary use.

See [Developer Trace Guide (Chinese)](docs/developer-tracing.md) and [Issue #5 checklist](https://github.com/juezhong/raycast-pathseek/issues/5).

## Testing and feedback

Use [Issue #1 — installation tests](https://github.com/juezhong/raycast-pathseek/issues/1) and [Issue #2 — manual index, fzf search and native icons](https://github.com/juezhong/raycast-pathseek/issues/2). Check off only behaviors you have actually verified and comment with reproducible steps and logs for failures.

Build checks (require installed npm dependencies):

```bash
npm run lint
npm run build
```

A `package-lock.json` file has not yet been generated and committed as part of a verified Mac installation. Store submission will require the lockfile, dependency verification, a unique icon and passing Raycast's checks.

## Status

| Phase | Status |
| --- | --- |
| P1 — Upstream audit & scaffolding | Code submitted; Mac build verification pending |
| P2 — explicit manual index, setup picker and safe index publishing | PR implementation; Mac verification pending |
| P3 — Unified fzf search and Finder native icons | Initial implementation; Mac verification pending |
| P4 — Open/Save Dialog Bridge | Not implemented |
| P5 — Tests & Raycast Store submission | Not started |

## License

[MIT License](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for upstream attribution. The current development icon is temporarily reused from the MIT-licensed Fuzzy File Search upstream extension; it must be replaced before publishing.

## Quick file selection and folder navigation in Open/Save dialogs (development)

**Search in Open/Save Dialog** focuses on two workflows: quickly selecting an indexed file in the original application's **Open** dialog, or navigating to an indexed folder in its **Open/Save** dialog.

Press **Cmd+Shift+G** in the original panel first, search with PathSeek, and press **Return** to paste the **full selected path**. Confirm Go to Folder in the original dialog. Standard Open dialogs may highlight a full file path, but this must be verified on the user's Mac and may vary by app. Use **Cmd+K → Go to Containing Folder (Fallback)** to navigate to the parent directory instead.

There is **no automatic dialog detection, window manager, accessibility automation, background agent, or automatic Open/Save confirmation**. See [simple instructions](docs/open-save-dialog.md) and [Issue #7](https://github.com/juezhong/raycast-pathseek/issues/7).
