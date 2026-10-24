# Third-party notices

## Fuzzy File Search (Raycast Extension)

- Source: https://github.com/raycast/extensions/tree/main/extensions/fuzzy-file-search
- Original extension author: `erykksc` (with contributions from `gilitos92`)
- License: MIT (as declared in its `package.json`)

PathSeek takes inspiration from Fuzzy File Search's full-path search interface, `fd`/`fzf` integration, and Finder actions. The persistent-index implementation in PathSeek is independently developed and does **not** copy the original command's per-launch reindexing workflow.

The development icon at `assets/extension-icon.png` is temporarily reused from the upstream Fuzzy File Search extension under its MIT license. It must be replaced by an original PathSeek icon before Raycast Store submission.\n\nIf source code is migrated verbatim in subsequent phases, keep its relevant original copyright notices and license text here.

## Command-line dependencies

- `fd` — https://github.com/sharkdp/fd — user-installed executable
- `fzf` — https://github.com/junegunn/fzf — user-installed executable

The development version **does not download or bundle executables**. Install these trusted command-line tools separately, e.g. using Homebrew.
