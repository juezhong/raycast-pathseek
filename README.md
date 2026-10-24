# PathSeek

An open-source Raycast extension for macOS file search inspired by Listary.

> Early development version. Finder actions are available; navigation into a **pre-existing app Open/Save dialog is not implemented yet**.

## Features available in this development version

- Explicit **Rebuild Index** command uses `fd` to scan configured roots.
- The file list is persisted to Raycast's extension support directory and reused between searches and Raycast launches.
- **Search Files** uses `fzf` to fuzzy-match the existing index; it does not run `fd`.
- Results support Open, Show in Finder, Open With, Quick Look and Copy Path.

## Requirements

- macOS with Raycast installed and signed in
- Node.js **22.14+**, npm 7+
- Homebrew tools: `brew install fd fzf` (or set the absolute tool paths in extension preferences)

## Load into Raycast locally

```bash
git clone https://github.com/juezhong/raycast-pathseek.git
cd raycast-pathseek
npm install
npm run dev
```

On first install the repository might not yet have a `package-lock.json`; `npm install` will generate one. Commit that lockfile before a Store release. `npm run dev` imports the extension to Raycast and auto-reloads changes.

1. In Raycast, run **Rebuild Index**. Default indexed root is your home directory (`~`). Review preferences first if this is too large.
2. Run **Search Files**, type part of the path, and choose a file.
3. Subsequent searches read the saved index; rebuilding is **manual only**.

For large developer trees, review the exclude patterns in Raycast → Extensions → PathSeek, and only index directories you want to search.

## Project status

| Phase | Status |
| --- | --- |
| P1: Raycast scaffold and upstream audit | Work in progress; Mac build unverified |
| P2: Persistent manually rebuilt index | Initial implementation; Mac verification pending |
| P3: Fuzzy search + Finder actions | Initial implementation; Mac verification pending |
| P4: Open/Save dialog bridge | Not implemented |
| P5: Test and Raycast Store submission | Not started |

Plan and progress: [plans/pathseek-development/task_plan.md](plans/pathseek-development/task_plan.md).

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
