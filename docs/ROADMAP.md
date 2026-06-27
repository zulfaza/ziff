# Ziff roadmap

Last updated: 2026-06-27

Ziff is a local Git diff viewer. This doc tracks what we want to build and what's already in the app.

---

## At a glance

| Feature | Status | Summary |
| --- | --- | --- |
| [Diff by branch or commit](#1-diff-by-branch-or-commit) | `partial` | Working tree, branch, and commit diffs work; comparison not persisted across reload |
| [Auto-sync Git state](#2-auto-sync-git-state) | `planned` | Manual refresh only today |
| [Annotations (review & agent prompts)](#3-annotations-review--agent-prompts) | `planned` | Not started |
| [PR review import & sync](#4-pr-review-import--sync) | `planned` | Not started |
| [User settings](#5-user-settings) | `partial` | Settings modal, general prefs, and keybindings; sync/GitHub/appearance not built |

---

## Core features

### 1. Diff by branch or commit

**Goal:** Compare code easily — not just the working tree, but any branch tip or commit against a chosen base.

**Status:** `partial`

#### Already shipped

- [x] Working tree diff (staged, unstaged, untracked)
- [x] Per-file unified diff with split/stacked views
- [x] Branch list and checkout (`switchBranch`)
- [x] Commit history list (last 200 commits)
- [x] Worktree switching
- [x] **Compare mode picker** — working tree | branch | commit (`ComparisonControls`)
- [x] **Base / head selectors** — branch vs branch (e.g. `main...feature/foo`)
- [x] **Branch diff API** — `repo:compare` → `git diff base...head`
- [x] **Commit diff API** — `git show <hash>` for file list and per-file diffs
- [x] **History interaction** — click a commit to load its patch in the main panel
- [x] **Empty / binary handling** — “No changes” and “Binary file not shown” states in the diff panel

#### Still to build

- [ ] **Persist comparison** in UI state (survive refresh within session)
- [ ] **Commit range** (optional, later)
- [ ] **Merge commit UX** — clearer messaging when a commit has no parent diff or multiple parents

#### Acceptance criteria

- User can pick two refs (branch or commit) and see a file list + diffs like the current Changes tab.
- User can click a commit in History and view that commit's patch.
- Switching comparison mode does not mutate Git state (read-only diff).

#### Notes

- `DiffComparison` and `repo:compare` live in `shared.ts` / `electron/main.ts`; working-tree diffs still use `repo:diff`.
- Commit mode is entered from History — the toolbar commit button reflects the active selection but does not open a commit picker on its own.

---

### 2. Auto-sync Git state

**Goal:** When Git changes outside Ziff (terminal, IDE, another app), the UI updates without clicking Refresh.

**Status:** `planned`

#### Tasks

- [ ] Watch `.git/HEAD`, `.git/index`, and worktree files for changes
- [ ] Debounce refresh (e.g. 300–500 ms) to avoid thrashing during large operations
- [ ] Push updates to renderer via IPC event (e.g. `repo:changed` → call existing `readSnapshot()`)
- [ ] Respect active comparison mode — re-fetch diffs for current base/head, not only working tree
- [ ] **Pause sync** while user is mid-action (staging, commit message draft) — optional v1
- [ ] Surface subtle “synced” / “updating…” indicator in header

#### Acceptance criteria

- Checkout, commit, or `git add` in an external terminal reflects in Ziff within ~1 s.
- No duplicate refresh storms during `git rebase` or `pnpm install`-scale file churn (debounced).
- Manual Refresh still works and forces immediate reload.

#### Notes

- Options: Node `fs.watch` on repo root (simple) vs `chokidar` (more reliable cross-platform).
- Also watch `.git/logs/HEAD` for branch switches and commits.
- Must handle missing repo / deleted worktree gracefully.

---

### 3. Annotations (review & agent prompts)

**Goal:** Attach notes to lines or hunks that serve as human PR review comments or structured prompts for coding agents.

**Status:** `planned`

#### Concepts

| Type | Purpose |
| --- | --- |
| **Review** | Human feedback — severity, suggestion, question |
| **Agent prompt** | Actionable instruction for an AI agent (fix, refactor, explain) |

Annotations should be anchored to:

- File path
- Side (old / new / either)
- Line number (and optionally hunk id)
- Optional: commit or comparison context (so they survive ref changes when possible)

#### Tasks

- [ ] Data model — `Annotation { id, file, line, side, kind, body, createdAt, author? }`
- [ ] Storage — start local (JSON in app userData or `.ziff/annotations.json` in repo); decide repo-local vs global
- [ ] UI — gutter marker or selection popup to add/edit/delete
- [ ] List panel — filter by file, kind, unresolved
- [ ] Export formats:
  - [ ] Markdown review summary
  - [ ] Agent prompt bundle (e.g. one markdown file or JSON for Cursor/Codex)
- [ ] Import — merge annotations from file

#### Acceptance criteria

- User can add a review note on a diff line and see it after reload.
- User can export selected annotations as a single agent prompt.
- Annotations are clearly scoped to the current comparison (branch/commit) when relevant.

#### Open questions

- [ ] Store in repo (`.ziff/`, shareable) vs app-only (private drafts)?
- [ ] Thread / reply on annotations?
- [ ] Link annotation → GitHub review comment id after PR sync?

---

### 4. PR review import & sync

**Goal:** Pull review comments from a GitHub PR into Ziff annotations (and optionally push local notes back).

**Status:** `planned`

Depends on: [§3 Annotations](#3-annotations-review--agent-prompts) (at least local storage + line anchoring).

#### Tasks

- [ ] GitHub auth — PAT or `gh auth` token, stored in OS keychain
- [ ] Detect PR for current branch — `gh pr view` or GitHub API
- [ ] Fetch review comments — inline + top-level review threads
- [ ] Map API positions → file + line in current diff (handle outdated comments)
- [ ] Sync UI — show imported comments as annotations; badge for “from GitHub”
- [ ] Optional: push new local annotations as PR review comments (write scope)
- [ ] Optional: periodic sync when PR is open

#### Acceptance criteria

- User connects GitHub once and imports comments for the PR matching the current branch.
- Imported comments appear on the correct lines when the diff still matches; outdated comments are marked, not dropped silently.
- Re-import updates existing synced annotations without duplicates.

#### Open questions

- [ ] GitHub only for v1, or abstract provider interface?
- [ ] One-way import first, or bidirectional from the start?

---

### 5. User settings

**Goal:** One place to configure Ziff — UI preferences, sync behavior, and integrations — with changes persisted across sessions.

**Status:** `partial`

#### Already shipped

- [x] **Settings entry point** — Ziff → Settings… (app menu), header gear button, and `mod+,` shortcut
- [x] **Settings modal** — General and Keybindings tabs (`src/app/settings.tsx`)
- [x] **General**
  - [x] Default diff layout — `split` | `stacked` (persisted; applied on launch and when reset)
  - [x] Re-open last project on launch — toggle for `lastRepoPath` / `restoreLastRepo`
  - [x] Changes sidebar — file list view (`list` | `tree`) and group-by (`none` | `status`)
- [x] **Keybindings**
  - [x] Config file — `~/config/ziff/keybindings.json` with defaults seeded on first run
  - [x] Parser and runtime — shortcut strings, optional `when` expressions, merge with defaults (`src/keybindings.ts`, `src/keybindingsRuntime.ts`)
  - [x] Settings tab — read-only command list, open config in editor, restore defaults
  - [x] Hot reload — file watch in main process pushes `keybindings:changed` to renderer
- [x] **API surface** — `UserSettings` in `shared.ts` (`SidebarSettings` deprecated); IPC `settings:*` and `keybindings:*` handlers
- [x] **Config module** — `electron/config.ts` reads/writes settings and keybindings; migrates legacy files from Electron userData
- [x] **Reset** — restore defaults for general settings and keybindings (per tab)
- [x] Inline file-list settings menu (gear popover on Changes sidebar) — same source of truth as Settings modal
- [x] Internal persistence — last opened repo path, window size, preferred editor (main process only, not user-editable yet)

#### Still to build

- [ ] **In-app keybinding editor** — record/rebind shortcuts in the UI (v1 edits `keybindings.json` externally)
- [ ] **Sync** (ties to [§2 Auto-sync](#2-auto-sync-git-state))
  - [ ] Enable / disable auto-sync
  - [ ] Debounce interval (advanced, optional)
- [ ] **GitHub** (ties to [§4 PR review import](#4-pr-review-import--sync))
  - [ ] Connect via PAT or `gh auth` token
  - [ ] Token stored in OS keychain, not plain settings.json
  - [ ] Disconnect / rotate token
- [ ] **Appearance** (optional v1)
  - [ ] Theme — system | light | dark
  - [ ] Font size for diff content (optional)

#### Acceptance criteria

- User opens Settings from the app menu and changes persist after quit and relaunch.
- Sidebar file-list prefs remain editable from the inline gear menu *or* the settings panel (single source of truth).
- GitHub token is never written to `settings.json` in plaintext.
- Invalid or partial settings files fall back to defaults without breaking startup.

#### Notes

- User-facing config lives under `~/config/ziff/` (`settings.json`, `keybindings.json`); legacy Electron userData copies are migrated on first read.
- Main process `AppSettings` extends `UserSettings` with `lastRepoPath`, `windowSize`, and `preferredEditor`.
- Settings for annotations export defaults can land when [§3](#3-annotations-review--agent-prompts) ships.

---

## Supporting work (not core, but likely needed)

| Item | Status | Notes |
| --- | --- | --- |
| Comparison state in `RepoSnapshot` / new API types | `partial` | `DiffComparison` + `repo:compare` shipped; session persistence still missing |
| Tests for diff ref parsing | `partial` | `src/gitDiff.test.ts` covers comparison file lists; expand as ref parsing grows |
| Keybinding parser / runtime tests | `done` | `src/keybindings.test.ts` |

---

## Changelog (doc only)

| Date | Change |
| --- | --- |
| 2026-06-27 | Initial roadmap — four core features from product vision |
| 2026-06-27 | Added [§5 User settings](#5-user-settings) — prefs, sync, GitHub, appearance |
| 2026-06-27 | Updated [§1](#1-diff-by-branch-or-commit) and [§5](#5-user-settings) — branch/commit diff and settings modal shipped on `feat/settings` |

---

## Adding a new feature

1. Add a row to **At a glance**.
2. Copy the section template below into **Core features** (or a new tier if it's later work).
3. Set status to `planned` and fill acceptance criteria before coding.

### Section template

```markdown
### N. Feature name

**Goal:** One sentence.

**Status:** `planned`

#### Tasks
- [ ] ...

#### Acceptance criteria
- ...

#### Notes
- ...
```
