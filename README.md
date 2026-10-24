# PathSeek

[**English**](README.md) | [简体中文](README.zh-CN.md)

**PathSeek** is an open-source macOS file-search extension for Raycast, inspired by the fast file navigation workflow of Windows Listary.

> **Early development / local testing only.** Persistent indexing, fuzzy search and Finder actions have initial implementations but have **not yet passed macOS GUI/build verification**. Returning a result to an existing application's Open/Save dialog is a planned feature, **not implemented**.

## Features

- **Persistent index with a 15-day refresh window** — First build manually via `Rebuild Index`. Once at least 15 days old, opening Search Files attempts a refresh, without a resident scheduler.
- **Fuzzy or regex search** — `Search Files` provides fzf fuzzy matching and JavaScript regular expressions against full paths. Typing queries never invokes fd.
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
2. **Rebuild Index** — manually create the index. **Before the first run**, set `Search Roots` to a small directory (e.g. `~/Projects`) rather than indexing your entire home directory.
3. **Search Files** — type a filename, folder name or part of a path; select a result and use its actions.
4. **Debug Info** — if a test fails, copy the sanitized report into [Issue #1](https://github.com/juezhong/raycast-pathseek/issues/1).

An index 15 days old is refreshed when Search Files is next opened, not by a background daemon. Failed auto-refresh attempts are throttled for 24 hours. Manually rebuild whenever newer files are needed.

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
└── index-<UUID>.nul      # Old version may coexist briefly during rebuild
```

The index may contain private file names and paths; do not upload it to public GitHub Issues. Rebuilds are serialized with a cross-process lock, and older generations are removed only after the new index has been published and verified. See [Index Storage & Maintenance (中文)](docs/index-storage.md) for the file format, update/rollback strategy and read-only inspection commands.

### Search modes

Choose **Fuzzy (fzf)** or **Regex (full path)** in the Search Files dropdown. Regex examples: `\.tsx?$` finds TypeScript extensions, and `src/.*/config` finds nested configuration paths. Regex matches **paths only, not file contents**.

## Documentation

| Document | Purpose |
| --- | --- |
| [Architecture (中文)](docs/architecture.md) | Module map, control/data flow and trade-offs |
| [Index Storage (中文)](docs/index-storage.md) | Exact location discovery, index formats, build/search behavior |
| [Development & Testing (中文)](docs/development.md) | Load in Raycast, configure, test and troubleshoot |
| [Development Plan (中文)](plans/pathseek-development/task_plan.md) | Phases, acceptance criteria and next step |
| [中文 README](README.zh-CN.md) | Complete Chinese user guide |

## Testing and feedback

Use [Issue #1 — installation tests](https://github.com/juezhong/raycast-pathseek/issues/1) and [Issue #2 — 15-day refresh, regex and native icons](https://github.com/juezhong/raycast-pathseek/issues/2). Check off only behaviors you have actually verified and comment with reproducible steps and logs for failures.

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
| P2 — 15-day refresh and safe index cleanup | Initial implementation; Mac verification pending |
| P3 — Fuzzy / regex search and Finder native icons | Initial implementation; Mac verification pending |
| P4 — Open/Save Dialog Bridge | Not implemented |
| P5 — Tests & Raycast Store submission | Not started |

## License

[MIT License](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for upstream attribution. The current development icon is temporarily reused from the MIT-licensed Fuzzy File Search upstream extension; it must be replaced before publishing.
