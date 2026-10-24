# PathSeek

[**English**](README.md) | [简体中文](README.zh-CN.md)

**PathSeek** is an open-source macOS file-search extension for Raycast, inspired by the fast file navigation workflow of Windows Listary.

> **Early development / local testing only.** Persistent indexing, fuzzy search and Finder actions have initial implementations but have **not yet passed macOS GUI/build verification**. Returning a result to an existing application's Open/Save dialog is a planned feature, **not implemented**.

## Features

- **Manual persistent index** — `Rebuild Index` uses `fd` to scan selected directories. Index files survive restarting Raycast.
- **Fast path-aware search** — `Search Files` uses `fzf` on the saved index and **does not run `fd`** during normal searches.
- **Finder actions** — Open, Show in Finder, Open Containing Folder, Open With, Quick Look and Copy Absolute Path.
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
2. **Rebuild Index** — manually create the index. **Before the first run**, set `Search Roots` to a small directory (e.g. `~/Projects`) rather than indexing your entire home directory.
3. **Search Files** — type a filename, folder name or part of a path; select a result and use its actions.
4. **Debug Info** — if a test fails, copy the sanitized report into [Issue #1](https://github.com/juezhong/raycast-pathseek/issues/1).

No automatic reindexing or directory watcher runs in the current version. Files created after the last build will not be searchable until you rebuild.

### Preferences

| Preference | Meaning | Example |
| --- | --- | --- |
| Search Roots | Directories separated by semicolons or line breaks; `~` expands to your home | `~/Projects;~/Downloads` |
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
├── index.json            # Active index metadata: filename, timestamp, count, search roots
├── index-<UUID>.nul      # Active index; UTF-8 absolute paths separated by NUL bytes
└── index-<UUID>.nul      # Older generations may remain until explicit cleanup is implemented
```

The index may contain private file names and paths; do not upload it to public GitHub Issues. Automatic removal of old index generations is temporarily disabled to avoid a possible race between overlapping rebuilds; inspect actual disk usage in Index Status/Finder. See [Index Storage & Maintenance (中文)](docs/index-storage.md) for the file format, update/rollback strategy and read-only inspection commands.

## Documentation

| Document | Purpose |
| --- | --- |
| [Architecture (中文)](docs/architecture.md) | Module map, control/data flow and trade-offs |
| [Index Storage (中文)](docs/index-storage.md) | Exact location discovery, index formats, build/search behavior |
| [Development & Testing (中文)](docs/development.md) | Load in Raycast, configure, test and troubleshoot |
| [Development Plan (中文)](plans/pathseek-development/task_plan.md) | Phases, acceptance criteria and next step |
| [中文 README](README.zh-CN.md) | Complete Chinese user guide |

## Testing and feedback

Please use [GitHub Issue #1 — macOS/Raycast local test checklist (中文)](https://github.com/juezhong/raycast-pathseek/issues/1). Check off only behaviors you have actually verified and comment with reproducible steps and logs for failures.

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
| P2 — Manual persistent index | Initial implementation; Mac verification pending |
| P3 — fzf search & Finder actions | Initial implementation; Mac verification pending |
| P4 — Open/Save Dialog Bridge | Not implemented |
| P5 — Tests & Raycast Store submission | Not started |

## License

[MIT License](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for upstream attribution. The current development icon is temporarily reused from the MIT-licensed Fuzzy File Search upstream extension; it must be replaced before publishing.
