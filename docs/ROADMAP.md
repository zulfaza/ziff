# Ziff roadmap

Last updated: 2026-06-27

Ziff is a local Git diff viewer. This doc tracks what we want to build and what's already in the app.

---

## At a glance

| Feature | Status | Summary |
| --- | --- | --- |
| [Diff by branch or commit](#1-diff-by-branch-or-commit) | `partial` | Working-tree diff works; branch/commit comparison not built |
| [Auto-sync Git state](#2-auto-sync-git-state) | `planned` | Manual refresh only today |
| [Annotations (review & agent prompts)](#3-annotations-review--agent-prompts) | `planned` | Not started |
| [PR review import & sync](#4-pr-review-import--sync) | `planned` | Not started |
| [User settings](#5-user-settings) | `partial` | Sidebar prefs persist; no dedicated settings UI yet |

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

#### Still to build

- [ ] **Compare mode picker** — choose diff source: `working tree` | `branch` | `commit`
- [ ] **Base / head selectors**
  - Branch vs branch (e.g. `main...feature/foo`)
  - Commit vs parent (single commit diff)
  - Commit vs branch tip
  - Commit range (optional, later)
- [ ] **Branch diff API** — e.g. `git diff base...head` or `git diff base head`
- [ ] **Commit diff API** — e.g. `git show <hash>` or `git diff <hash>^..<hash>`
- [ ] **History interaction** — click a commit to load its diff in the main panel
- [ ] **Persist comparison** in UI state (survive refresh within session)
- [ ] **Empty / merge commit handling** — clear message when diff is empty or binary-only

#### Acceptance criteria

- User can pick two refs (branch or commit) and see a file list + diffs like the current Changes tab.
- User can click a commit in History and view that commit's patch.
- Switching comparison mode does not mutate Git state (read-only diff).

#### Notes

- Current `getDiff(path)` only reads working tree / index (`electron/main.ts` → `repo:diff`).
- `HistoryList` renders commits but has no selection handler yet.

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

- [x] Persist sidebar prefs — file list view (`list` | `tree`) and group-by (`none` | `status`)
- [x] Settings storage — `settings.json` in app userData (`electron/main.ts`)
- [x] Inline file-list settings menu (gear popover on Changes sidebar)
- [x] Internal persistence — last opened repo path, window size (main process only, not user-editable yet)

#### Still to build

- [ ] **Settings entry point** — app menu item (e.g. Ziff → Settings…) and/or header button; opens a dedicated panel or modal
- [ ] **General**
  - [ ] Default diff view — `split` | `stacked` (persist and apply on file open)
  - [ ] Re-open last repo on launch — toggle for `lastRepoPath` behavior
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
- [ ] **API surface** — extend `SidebarSettings` → `UserSettings` in `shared.ts`; expose safe subset to renderer; keep secrets in main process only
- [ ] **Reset** — restore defaults per section or all settings

#### Acceptance criteria

- User opens Settings from the app menu and changes persist after quit and relaunch.
- Sidebar file-list prefs remain editable from the inline gear menu *or* the settings panel (single source of truth).
- GitHub token is never written to `settings.json` in plaintext.
- Invalid or partial settings files fall back to defaults without breaking startup.

#### Notes

- Current types: `SidebarSettings` in `shared.ts`; main process `AppSettings` adds `lastRepoPath` and `windowSize`.
- Consider macOS standard Preferences window vs in-app modal — modal is fine for v1.
- Settings for annotations export defaults can land when [§3](#3-annotations-review--agent-prompts) ships.

---

## Supporting work (not core, but likely needed)

| Item | Status | Notes |
| --- | --- | --- |
| Comparison state in `RepoSnapshot` / new API types | `planned` | Extend `shared.ts` |
| Tests for diff ref parsing | `planned` | `src/gitDiff` + new git helpers |

---

## Changelog (doc only)

| Date | Change |
| --- | --- |
| 2026-06-27 | Initial roadmap — four core features from product vision |
| 2026-06-27 | Added [§5 User settings](#5-user-settings) — prefs, sync, GitHub, appearance |

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
