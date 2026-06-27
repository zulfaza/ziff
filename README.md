# Ziff

A local Git diff viewer for reviewing changes before you commit, open a PR, or hand work to a coding agent.

Ziff is a desktop app (Electron + React) that focuses on the review loop: browse changed files, read unified diffs with syntax highlighting, compare branches or commits, and stage or commit without leaving the app.

> **Early WIP.** Expect rough edges. See [docs/ROADMAP.md](./docs/ROADMAP.md) for planned work.

## Features

- **Working tree diff** — staged, unstaged, and untracked files in one place
- **Branch & commit comparison** — compare refs (e.g. `main...feature`, a single commit, or branch vs branch)
- **Split & stacked views** — side-by-side or unified diff layout, with automatic fallback on narrow panels
- **Syntax highlighting** — powered by [Shiki](https://shiki.style/)
- **Image previews** — before/after for common image formats in diffs
- **Git workflow** — stage/unstage, commit, switch branches, switch worktrees
- **History** — recent commits for the current repo
- **Open in Zed** — jump from a diff line to the file in [Zed](https://zed.dev/)
- **Recent projects** — reopen repos quickly from the splash screen

## Inspiration

Ziff is heavily inspired by two projects the author keeps close at hand:

| Project | What we borrowed |
| --- | --- |
| [**T3 Code**](https://github.com/pingdotgg/t3code) | Desktop-first dev tooling, Electron + Vite + React stack, and a focused single-purpose UI |
| [**Zed**](https://github.com/zed-industries/zed) | Workbench layout, keyboard-driven navigation, and the idea of a fast local tool that stays out of your way |

Neither project endorses Ziff; this is an independent experiment.

## Requirements

- [Node.js](https://nodejs.org/) (LTS recommended)
- [pnpm](https://pnpm.io/) 10+
- [Git](https://git-scm.com/)
- [Zed](https://zed.dev/) (optional, for “open in editor”)

## Development

```bash
pnpm install
```

Run the Vite dev server and Electron in separate terminals:

```bash
pnpm dev
pnpm start
```

Other scripts:

| Command | Description |
| --- | --- |
| `pnpm build` | Typecheck and build renderer + main process |
| `pnpm dist` | Build and package with electron-builder |
| `pnpm test` | Run unit tests |
| `pnpm lint` | Run oxlint |
| `pnpm fmt` | Format with oxfmt |

Packaged builds land in `release/`.

## Project layout

```
electron/          Main process (Git, IPC, settings)
src/app/           React UI
src/gitDiff.ts     Diff parsing and file list logic
src/shared.ts      Shared types and IPC contract
docs/              Roadmap and planning notes
```

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘B` | Toggle sidebar |
| `⌘⌥O` | Open recent project |
| `⌘⌃W` | Switch worktree |
| `⌘⌃B` | Switch branch |

## Docs

- [Roadmap](./docs/ROADMAP.md) — feature status and acceptance criteria
- [Docs index](./docs/README.md) — how planning docs are organized

## License

ISC
