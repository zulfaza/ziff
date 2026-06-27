import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Code2,
  ExternalLink,
  FileCode2,
  Filter,
  Folder,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  GitFork,
  ImageIcon,
  Monitor,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  createContext,
  memo,
  useContext,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clamp,
  collectFilePaths,
  getBasename,
  getDirectory,
  getInlineFragments,
  getPrimaryArea,
  lineKey,
  mergeSyntax,
  organizeFiles,
} from "./diffModel";
import { type HighlightIndex, useDiffHighlight } from "./highlighter";
import type {
  DiffPreview,
  FileGroupBy,
  FileListView,
  FileTreeNode,
  HeaderMenu,
  RecentProject,
} from "./types";
import type {
  BranchEntry,
  CommitEntry,
  DiffComparison,
  DiffHunk,
  GitFileEntry,
  ImagePreview,
  RepoInfo,
  RepoSnapshot,
  SplitDiffRow,
  ViewMode,
  WorktreeEntry,
} from "../shared";

type DiffBodyStyle = CSSProperties & { "--split-width": string };

type FileRenderMode = "code" | "preview";

type ImagePreviewState =
  | { type: "loading" }
  | { type: "ready"; preview: ImagePreview }
  | { type: "error"; message: string };

type ImagePreviewKind = "raster" | "svg";

interface RenderImagePreviewSide {
  dataUrl: string;
  label: "After" | "Before";
}

interface LineRange {
  start: number;
  end: number;
}

interface HunkLineInfo {
  collapsedLines: number;
  newRange: LineRange | null;
  oldRange: LineRange | null;
}

const formatter = new Intl.NumberFormat("en-US");
const recentBranchLimit = 8;

export function ComparisonControls({
  comparison,
  info,
  onChange,
}: {
  comparison: DiffComparison;
  info: RepoInfo;
  onChange(comparison: DiffComparison): void;
}) {
  const branchNames = useMemo(() => getBranchNames(info), [info]);
  const branchOptions = useMemo(() => getBranchOptions(info), [info]);
  const branchComparison: DiffComparison =
    comparison.type === "branch"
      ? comparison
      : {
          type: "branch",
          base: getDefaultBaseBranch(branchNames, info.branch),
          head: info.branch,
        };

  return (
    <section className="compare-controls" aria-label="Diff comparison">
      <div className="segmented compare-mode" aria-label="Compare mode">
        <DelayedPopover label="Working Tree">
          <button
            aria-label="Working tree diff"
            className={comparison.type === "working-tree" ? "active" : ""}
            onClick={() => onChange({ type: "working-tree" })}
          >
            <FileCode2 size={15} />
          </button>
        </DelayedPopover>
        <DelayedPopover label="Branch Diff">
          <button
            aria-label="Branch diff"
            className={comparison.type === "branch" ? "active" : ""}
            onClick={() => onChange(branchComparison)}
          >
            <GitCompareArrows size={15} />
          </button>
        </DelayedPopover>
        <DelayedPopover label="Pick Commit In History">
          <button
            aria-label="Commit diff"
            className={comparison.type === "commit" ? "active" : ""}
            disabled={comparison.type !== "commit"}
          >
            <GitCommitHorizontal size={15} />
          </button>
        </DelayedPopover>
      </div>
      {comparison.type === "branch" ? (
        <div className="branch-compare-controls">
          <BranchComparePicker
            label="Base ref"
            branches={branchOptions}
            currentBranch={info.branch}
            value={comparison.base}
            onChange={(base) => onChange({ ...comparison, base })}
          />
          <span className="compare-range">...</span>
          <BranchComparePicker
            label="Head ref"
            branches={branchOptions}
            currentBranch={info.branch}
            value={comparison.head}
            onChange={(head) => onChange({ ...comparison, head })}
          />
        </div>
      ) : null}
      {comparison.type === "commit" ? (
        <span className="commit-compare-label" title={comparison.hash}>
          {comparison.hash.slice(0, 7)}
        </span>
      ) : null}
    </section>
  );
}

function BranchComparePicker({
  branches,
  currentBranch,
  label,
  onChange,
  value,
}: {
  branches: readonly BranchEntry[];
  currentBranch: string;
  label: string;
  onChange(value: string): void;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmedQuery = deferredQuery.trim().toLowerCase();
  const visibleBranches = useMemo(
    () =>
      trimmedQuery.length === 0
        ? getRecentBranches(branches, value)
        : branches.filter((branch) => branch.name.toLowerCase().includes(trimmedQuery)),
    [branches, trimmedQuery, value],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    function closePicker(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && wrapRef.current?.contains(target) === true) {
        return;
      }
      setOpen(false);
      setQuery("");
    }

    window.addEventListener("mousedown", closePicker);
    return () => window.removeEventListener("mousedown", closePicker);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    inputRef.current?.focus();
  }, [open]);

  function selectBranch(branch: string) {
    onChange(branch);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="branch-compare-picker" ref={wrapRef}>
      <button
        className={open ? "branch-compare-trigger active" : "branch-compare-trigger"}
        onClick={() => setOpen((current) => !current)}
        title={value}
      >
        <span className="branch-compare-label">{label}</span>
        <GitBranch size={13} />
        <span className="branch-compare-value">{value}</span>
        <ChevronDown size={13} />
      </button>
      {open ? (
        <section className="branch-compare-popover">
          <label className="branch-compare-search">
            <Search size={14} />
            <input
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                  setQuery("");
                }
                if (event.key === "Enter") {
                  const first = visibleBranches[0];
                  if (first != null) {
                    event.preventDefault();
                    selectBranch(first.name);
                  }
                }
              }}
              placeholder="Search branches..."
              ref={inputRef}
              value={query}
            />
          </label>
          {trimmedQuery.length === 0 ? (
            <div className="branch-compare-section-title">Recent Branches</div>
          ) : null}
          <div className="branch-compare-list">
            {visibleBranches.length === 0 ? (
              <div className="branch-compare-empty">No branches found</div>
            ) : (
              visibleBranches.map((branch) => (
                <button
                  className={
                    branch.name === value ? "branch-compare-row active" : "branch-compare-row"
                  }
                  key={branch.name}
                  onClick={() => selectBranch(branch.name)}
                >
                  <span className="branch-compare-row-name">{branch.name}</span>
                  <BranchCompareBadge branch={branch} currentBranch={currentBranch} />
                </button>
              ))
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function BranchCompareBadge({
  branch,
  currentBranch,
}: {
  branch: BranchEntry;
  currentBranch: string;
}) {
  if (branch.name === currentBranch) {
    return <span className="branch-compare-badge">current</span>;
  }
  if (branch.name === "main" || branch.name === "master") {
    return <span className="branch-compare-badge">default</span>;
  }
  return null;
}

function getBranchNames(info: RepoInfo): readonly string[] {
  const names = getBranchOptions(info).map((branch) => branch.name);
  return names.includes(info.branch) ? names : [info.branch, ...names];
}

function getBranchOptions(info: RepoInfo): readonly BranchEntry[] {
  if (info.branches.some((branch) => branch.name === info.branch)) {
    return info.branches;
  }
  return [
    {
      author: "",
      isCurrent: true,
      name: info.branch,
      relativeTime: "",
      subject: "",
    },
    ...info.branches,
  ];
}

function getRecentBranches(
  branches: readonly BranchEntry[],
  selectedBranch: string,
): readonly BranchEntry[] {
  const recent = branches.slice(0, recentBranchLimit);
  if (recent.some((branch) => branch.name === selectedBranch)) {
    return recent;
  }
  const selected = branches.find((branch) => branch.name === selectedBranch);
  return selected == null ? recent : [selected, ...recent.slice(0, recentBranchLimit - 1)];
}

function getDefaultBaseBranch(branches: readonly string[], currentBranch: string): string {
  const main = branches.find((branch) => branch === "main" && branch !== currentBranch);
  if (main != null) {
    return main;
  }
  const master = branches.find((branch) => branch === "master" && branch !== currentBranch);
  if (master != null) {
    return master;
  }
  return branches.find((branch) => branch !== currentBranch) ?? currentBranch;
}

export function RepoHeader({
  menu,
  onChooseRepo,
  onForgetProject,
  onMenuChange,
  onOpenProjectWindow,
  onSwitchBranch,
  onSwitchProject,
  onSwitchWorktree,
  recentProjects,
  snapshot,
}: {
  menu: HeaderMenu | null;
  onChooseRepo(): void;
  onForgetProject(path: string): void;
  onMenuChange(menu: HeaderMenu | null): void;
  onOpenProjectWindow(path: string): void;
  onSwitchBranch(branch: string): void;
  onSwitchProject(path: string): void;
  onSwitchWorktree(path: string): void;
  recentProjects: readonly RecentProject[];
  snapshot: RepoSnapshot;
}) {
  const info = snapshot.info;
  return (
    <nav className="repo-header" aria-label="Repository">
      <HeaderSelector
        active={menu === "project"}
        kind="project"
        label={info.projectName}
        onClick={() => onMenuChange(toggleMenu(menu, "project"))}
      >
        {menu === "project" ? (
          <ProjectMenu
            currentPath={info.path}
            projects={recentProjects}
            onChooseRepo={onChooseRepo}
            onForgetProject={onForgetProject}
            onOpenProjectWindow={onOpenProjectWindow}
            onSwitchProject={onSwitchProject}
          />
        ) : null}
      </HeaderSelector>
      <HeaderSelector
        active={menu === "worktree"}
        icon={<GitFork size={15} />}
        kind="meta"
        label={info.worktree}
        onClick={() => onMenuChange(toggleMenu(menu, "worktree"))}
      >
        {menu === "worktree" ? (
          <WorktreeMenu
            currentBranch={info.branch}
            worktrees={info.worktrees}
            onSwitchWorktree={onSwitchWorktree}
          />
        ) : null}
      </HeaderSelector>
      <span className="header-slash">/</span>
      <HeaderSelector
        active={menu === "branch"}
        icon={<GitBranch size={15} />}
        kind="meta"
        label={info.branch}
        onClick={() => onMenuChange(toggleMenu(menu, "branch"))}
      >
        {menu === "branch" ? (
          <BranchMenu branches={info.branches} onSwitchBranch={onSwitchBranch} />
        ) : null}
      </HeaderSelector>
    </nav>
  );
}

function HeaderSelector({
  active,
  children,
  icon,
  kind,
  label,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  icon?: ReactNode;
  kind: "project" | "meta";
  label: string;
  onClick(): void;
}) {
  const className = active ? `header-selector ${kind} active` : `header-selector ${kind}`;
  return (
    <div className="header-menu-wrap">
      <button className={className} title={label} onClick={onClick}>
        {icon}
        <span>{label}</span>
        <ChevronDown className="header-selector-chevron" size={13} />
      </button>
      {children}
    </div>
  );
}

function ProjectMenu({
  currentPath,
  onChooseRepo,
  onForgetProject,
  onOpenProjectWindow,
  onSwitchProject,
  projects,
}: {
  currentPath: string;
  onChooseRepo(): void;
  onForgetProject(path: string): void;
  onOpenProjectWindow(path: string): void;
  onSwitchProject(path: string): void;
  projects: readonly RecentProject[];
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.toLowerCase();
  const filteredProjects = projects.filter(
    (project) =>
      project.path !== currentPath && project.name.toLowerCase().includes(normalizedQuery),
  );
  return (
    <section className="header-menu project-menu">
      <SearchField onChange={setQuery} placeholder="Search projects..." value={query} />
      <div className="menu-section-title">Recent Projects</div>
      <div className="menu-list">
        {filteredProjects.map((project) => (
          <div className="menu-row project-row" key={project.path}>
            <button
              className="project-row-main"
              onClick={() => onSwitchProject(project.path)}
              title={project.path}
            >
              <Monitor size={17} />
              <span className="menu-primary">{project.name}</span>
            </button>
            <div className="project-row-actions">
              <button
                aria-label={`Open ${project.name} in new window`}
                className="menu-action-button"
                onClick={() => onOpenProjectWindow(project.path)}
                title="Open in new window"
              >
                <ExternalLink size={15} />
              </button>
              <button
                aria-label={`Remove ${project.name} from recent projects`}
                className="menu-action-button"
                onClick={() => onForgetProject(project.path)}
                title="Delete"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="menu-footer">
        <button onClick={onChooseRepo}>Open Local Folder</button>
      </div>
    </section>
  );
}

function WorktreeMenu({
  currentBranch,
  onSwitchWorktree,
  worktrees,
}: {
  currentBranch: string;
  onSwitchWorktree(path: string): void;
  worktrees: readonly WorktreeEntry[];
}) {
  const [query, setQuery] = useState("");
  const filteredWorktrees = worktrees.filter((worktree) =>
    worktree.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="header-menu worktree-menu">
      <SearchField
        onChange={setQuery}
        placeholder="Select or type to create a worktree..."
        value={query}
      />
      <button className="menu-row create-row">
        <Plus size={18} />
        <span className="menu-primary">Create new worktree based on {currentBranch}</span>
      </button>
      <div className="menu-list">
        {filteredWorktrees.map((worktree) => (
          <button
            className={worktree.isCurrent ? "menu-row active" : "menu-row"}
            key={worktree.path}
            onClick={() => onSwitchWorktree(worktree.path)}
          >
            <CheckMark visible={worktree.isCurrent} />
            <span>
              <span className="menu-primary">{worktree.name} worktree</span>
              <span className="menu-secondary">
                {worktree.branch} · {worktree.shortHead} · {worktree.path}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function BranchMenu({
  branches,
  onSwitchBranch,
}: {
  branches: readonly BranchEntry[];
  onSwitchBranch(branch: string): void;
}) {
  const [query, setQuery] = useState("");
  const filteredBranches = branches.filter((branch) =>
    branch.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="header-menu branch-menu">
      <div className="menu-tabs">
        <button className="active">Branches</button>
        <button>Stashes</button>
      </div>
      <div className="menu-search-row">
        <SearchField
          onChange={setQuery}
          placeholder="Switch or type to create a branch..."
          value={query}
        />
        <button className="menu-icon-button" title="Filter branches">
          <Filter size={18} />
        </button>
      </div>
      <div className="menu-list">
        {filteredBranches.map((branch) => (
          <button
            className={branch.isCurrent ? "menu-row active" : "menu-row"}
            key={branch.name}
            onClick={() => onSwitchBranch(branch.name)}
          >
            <CheckMark visible={branch.isCurrent} />
            <span>
              <span className="menu-primary">{branch.name}</span>
              <span className="menu-secondary">
                {branch.author} · {branch.relativeTime} · {branch.subject}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SearchField({
  onChange,
  placeholder,
  value,
}: {
  onChange(value: string): void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="menu-search">
      <Search size={15} />
      <input
        autoFocus
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function CheckMark({ visible }: { visible: boolean }) {
  return <span className="menu-check">{visible ? <Check size={15} /> : null}</span>;
}

// Shared drag core. Uses pointer capture so events keep flowing even when the
// cursor outruns the handle, and writes each frame straight to the DOM (`apply`)
// instead of React state — the live value never triggers a re-render of the
// (potentially huge) diff tree. State is committed once, on release (`commit`).
function startResizeDrag({
  apply,
  commit,
  event,
  max,
  measure,
  min,
}: {
  apply(value: number): void;
  commit(value: number): void;
  event: PointerEvent<HTMLDivElement>;
  max: number;
  measure(clientX: number): number;
  min: number;
}) {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  const handle = event.currentTarget;
  try {
    handle.setPointerCapture(event.pointerId);
  } catch {
    return;
  }

  document.documentElement.classList.add("is-resizing");
  window.getSelection()?.removeAllRanges();

  let pending = clamp(measure(event.clientX), min, max);
  let frameId: number | null = null;

  function flush() {
    frameId = null;
    apply(pending);
  }

  function onMove(moveEvent: globalThis.PointerEvent) {
    if (moveEvent.pointerId !== event.pointerId) {
      return;
    }
    pending = clamp(measure(moveEvent.clientX), min, max);
    if (frameId == null) {
      frameId = window.requestAnimationFrame(flush);
    }
  }

  function cleanup() {
    if (frameId != null) {
      window.cancelAnimationFrame(frameId);
      frameId = null;
    }
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onCancel);
    document.documentElement.classList.remove("is-resizing");
  }

  function onUp(upEvent: globalThis.PointerEvent) {
    if (upEvent.pointerId !== event.pointerId) {
      return;
    }
    cleanup();
    apply(pending);
    commit(pending);
  }

  function onCancel(cancelEvent: globalThis.PointerEvent) {
    if (cancelEvent.pointerId !== event.pointerId) {
      return;
    }
    cleanup();
  }

  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onCancel);
}

export function ResizeHandle({
  defaultValue,
  label,
  max,
  min,
  onResize,
  value,
}: {
  defaultValue: number;
  label: string;
  max: number;
  min: number;
  onResize(value: number): void;
  value: number;
}) {
  function startResize(event: PointerEvent<HTMLDivElement>) {
    const workbench = event.currentTarget.parentElement;
    if (workbench == null) {
      return;
    }
    const startX = event.clientX;
    const startValue = value;
    startResizeDrag({
      apply: (next) => workbench.style.setProperty("--sidebar-width", `${next}px`),
      commit: onResize,
      event,
      max,
      measure: (clientX) => startValue + clientX - startX,
      min,
    });
  }

  return (
    <div
      aria-label={label}
      className="panel-resizer"
      onDoubleClick={() => onResize(defaultValue)}
      onPointerDown={startResize}
      role="separator"
      tabIndex={0}
    />
  );
}

export function Splash({
  label,
  onClick,
  recentProjects,
  onOpenProject,
}: {
  label: string;
  onClick?: () => void;
  recentProjects?: readonly RecentProject[];
  onOpenProject?: (path: string) => void;
}) {
  const hasRecent = recentProjects != null && recentProjects.length > 0;
  return (
    <main className="splash">
      <div className="splash-inner">
        <img className="splash-logo" src="/icon.svg" alt="Ziff" />
        <p>{label}</p>
        {onClick == null ? null : (
          <button className="primary-button" onClick={onClick}>
            Open Repo
          </button>
        )}
        {hasRecent && onOpenProject != null ? (
          <div className="splash-recent">
            <div className="splash-recent-title">Recent Projects</div>
            <div className="splash-recent-list">
              {recentProjects.map((project) => (
                <button
                  className="splash-recent-row"
                  key={project.path}
                  onClick={() => onOpenProject(project.path)}
                  title={project.path}
                >
                  <Folder size={16} />
                  <span className="splash-recent-name">{project.name}</span>
                  <span className="splash-recent-path">{project.path}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export function ChangesPanel({
  files,
  fileGroupBy,
  fileListView,
  onFileGroupByChange,
  onFileListViewChange,
  onToggleReadMany,
  onViewDiff,
  readPaths,
  selectedPath,
  totalsAdded,
  totalsDeleted,
  onSelect,
  onToggleRead,
}: {
  files: readonly GitFileEntry[];
  fileGroupBy: FileGroupBy;
  fileListView: FileListView;
  onFileGroupByChange(groupBy: FileGroupBy): void;
  onFileListViewChange(view: FileListView): void;
  onToggleReadMany(paths: readonly string[], read: boolean): void;
  onViewDiff(): void;
  readPaths: ReadonlySet<string>;
  selectedPath: string | null;
  totalsAdded: number;
  totalsDeleted: number;
  onSelect(path: string): void;
  onToggleRead(path: string): void;
}) {
  const groups = useMemo(
    () => organizeFiles(files, { fileGroupBy, fileListView }),
    [files, fileGroupBy, fileListView],
  );
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const folderPaths = useMemo(
    () =>
      fileListView === "tree" ? collectFolderPaths(groups.flatMap((group) => group.nodes)) : [],
    [fileListView, groups],
  );
  const allCollapsed = folderPaths.length > 0 && folderPaths.every((p) => collapsedFolders.has(p));

  useEffect(() => {
    function closeSettings(event: MouseEvent) {
      if (
        event.target instanceof Element &&
        event.target.closest(".file-list-settings-wrap") != null
      ) {
        return;
      }
      setSettingsOpen(false);
    }

    if (!settingsOpen) {
      return;
    }

    window.addEventListener("mousedown", closeSettings);
    return () => window.removeEventListener("mousedown", closeSettings);
  }, [settingsOpen]);

  function toggleFolder(path: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function toggleAll() {
    setCollapsedFolders(allCollapsed ? new Set() : new Set(folderPaths));
  }

  return (
    <>
      <section className="sidebar-actions">
        <button className="link-button" onClick={onViewDiff}>
          View Diff
        </button>
        <span className="positive">+{formatter.format(totalsAdded)}</span>
        <span className="negative">-{formatter.format(totalsDeleted)}</span>
        <span className="sidebar-actions-spacer" />
        <div className="sidebar-action-buttons">
          <button
            className="icon-button"
            disabled={folderPaths.length === 0}
            onClick={toggleAll}
            title={allCollapsed ? "Expand all folders" : "Collapse all folders"}
          >
            {allCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
          </button>
          <div className="file-list-settings-wrap">
            <button
              className={settingsOpen ? "icon-button active" : "icon-button"}
              onClick={() => setSettingsOpen((open) => !open)}
              title="View settings"
            >
              <SlidersHorizontal size={14} />
            </button>
            {settingsOpen ? (
              <FileListSettingsMenu
                fileGroupBy={fileGroupBy}
                fileListView={fileListView}
                onFileGroupByChange={(groupBy) => {
                  onFileGroupByChange(groupBy);
                  setSettingsOpen(false);
                }}
                onFileListViewChange={(view) => {
                  onFileListViewChange(view);
                  setSettingsOpen(false);
                }}
              />
            ) : null}
          </div>
        </div>
      </section>
      <section className="file-list">
        {groups.map((group) => (
          <FileGroup
            key={group.label ?? "all"}
            label={group.label}
            files={group.files}
            nodes={group.nodes}
            readPaths={readPaths}
            collapsedFolders={collapsedFolders}
            onToggleFolder={toggleFolder}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onToggleRead={onToggleRead}
            onToggleReadMany={onToggleReadMany}
          />
        ))}
      </section>
    </>
  );
}

function FileListSettingsMenu({
  fileGroupBy,
  fileListView,
  onFileGroupByChange,
  onFileListViewChange,
}: {
  fileGroupBy: FileGroupBy;
  fileListView: FileListView;
  onFileGroupByChange(groupBy: FileGroupBy): void;
  onFileListViewChange(view: FileListView): void;
}) {
  return (
    <section className="file-list-settings-menu">
      <div className="menu-section-title">View</div>
      <button className="settings-menu-row" onClick={() => onFileListViewChange("list")}>
        <span>List</span>
        {fileListView === "list" ? <Check size={14} /> : null}
      </button>
      <button className="settings-menu-row" onClick={() => onFileListViewChange("tree")}>
        <span>Tree</span>
        {fileListView === "tree" ? <Check size={14} /> : null}
      </button>
      <div className="settings-menu-divider" />
      <div className="menu-section-title">Group By</div>
      <button className="settings-menu-row" onClick={() => onFileGroupByChange("none")}>
        <span>None</span>
        {fileGroupBy === "none" ? <Check size={14} /> : null}
      </button>
      <button className="settings-menu-row" onClick={() => onFileGroupByChange("status")}>
        <span>Status</span>
        {fileGroupBy === "status" ? <Check size={14} /> : null}
      </button>
    </section>
  );
}

function collectFolderPaths(nodes: readonly FileTreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind === "folder") {
      paths.push(node.path);
      paths.push(...collectFolderPaths(node.children));
    }
  }
  return paths;
}

// GitHub noreply emails encode the user's identity: "<id>+<login>@users.noreply.github.com"
// (or the older "<login>@users.noreply.github.com"). Derive an avatar URL from
// either form so commits authored on GitHub show the user's profile picture.
function getGithubAvatarUrl(email: string): string | null {
  const match = /^(?:(\d+)\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(email);
  if (match == null) {
    return null;
  }
  const id = match[1];
  const login = match[2];
  if (id != null) {
    return `https://avatars.githubusercontent.com/u/${id}?s=48&v=4`;
  }
  return `https://github.com/${login}.png?size=48`;
}

function CommitAvatar({ email }: { email: string }) {
  const url = getGithubAvatarUrl(email);
  const [failed, setFailed] = useState(false);
  if (url == null || failed) {
    return <UserRound size={14} />;
  }
  return <img alt="" className="commit-avatar" onError={() => setFailed(true)} src={url} />;
}

export function HistoryList({
  activeHash,
  commits,
  loading,
  onSelectCommit,
}: {
  activeHash: string | null;
  commits: readonly CommitEntry[];
  loading: boolean;
  onSelectCommit(hash: string): void;
}) {
  if (loading) {
    return <section className="history-list history-empty">Loading history</section>;
  }
  if (commits.length === 0) {
    return <section className="history-list history-empty">No commits</section>;
  }
  return (
    <section className="history-list">
      {commits.map((commit) => (
        <button
          className={commit.hash === activeHash ? "commit-row active" : "commit-row"}
          key={commit.hash}
          onClick={() => onSelectCommit(commit.hash)}
        >
          <div className="commit-subject" title={commit.subject}>
            {commit.subject}
          </div>
          <div className="commit-meta">
            <CommitAvatar email={commit.email} />
            <span className="commit-author">{commit.author}</span>
            <span className="commit-dot">·</span>
            <span>{commit.relativeTime}</span>
            <span className="commit-dot">·</span>
            <span>{commit.shortHash}</span>
          </div>
        </button>
      ))}
    </section>
  );
}

function FileGroup({
  label,
  files,
  nodes,
  onToggleReadMany,
  readPaths,
  collapsedFolders,
  onToggleFolder,
  selectedPath,
  onSelect,
  onToggleRead,
}: {
  label: string | null;
  files: readonly GitFileEntry[];
  nodes: readonly FileTreeNode[];
  onToggleReadMany(paths: readonly string[], read: boolean): void;
  readPaths: ReadonlySet<string>;
  collapsedFolders: ReadonlySet<string>;
  onToggleFolder(path: string): void;
  selectedPath: string | null;
  onSelect(path: string): void;
  onToggleRead(path: string): void;
}) {
  if (files.length === 0 && nodes.length === 0) {
    return null;
  }
  return (
    <section className="file-group">
      {label == null ? null : <div className="group-title">{label}</div>}
      {files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          readPaths={readPaths}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onToggleRead={onToggleRead}
        />
      ))}
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          readPaths={readPaths}
          collapsedFolders={collapsedFolders}
          onToggleFolder={onToggleFolder}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onToggleRead={onToggleRead}
          onToggleReadMany={onToggleReadMany}
        />
      ))}
    </section>
  );
}

function FileRow({
  file,
  readPaths,
  selectedPath,
  onSelect,
  onToggleRead,
}: {
  file: GitFileEntry;
  readPaths: ReadonlySet<string>;
  selectedPath: string | null;
  onSelect(path: string): void;
  onToggleRead(path: string): void;
}) {
  const name = getBasename(file.path);
  return (
    <div
      className={file.path === selectedPath ? "tree-row file-row selected" : "tree-row file-row"}
      style={{ paddingLeft: 12 }}
    >
      <button className="tree-file-button" onClick={() => onSelect(file.path)} title={file.path}>
        <span className={`file-change-icon ${getPrimaryArea(file.areas)}`} />
        <span>{name}</span>
      </button>
      <span className="tree-stats">
        <span className="positive">+{file.added}</span>
        <span className="negative">-{file.deleted}</span>
      </span>
      <input
        aria-label={`Mark ${file.path} read`}
        checked={readPaths.has(file.path)}
        className="read-check"
        onChange={() => onToggleRead(file.path)}
        type="checkbox"
      />
    </div>
  );
}

function TreeNode({
  node,
  onToggleReadMany,
  readPaths,
  collapsedFolders,
  onToggleFolder,
  selectedPath,
  onSelect,
  onToggleRead,
}: {
  node: FileTreeNode;
  onToggleReadMany(paths: readonly string[], read: boolean): void;
  readPaths: ReadonlySet<string>;
  collapsedFolders: ReadonlySet<string>;
  onToggleFolder(path: string): void;
  selectedPath: string | null;
  onSelect(path: string): void;
  onToggleRead(path: string): void;
}) {
  if (node.kind === "folder") {
    const open = !collapsedFolders.has(node.path);
    const childPaths = collectFilePaths(node);
    const readCount = childPaths.filter((path) => readPaths.has(path)).length;
    const isChecked = childPaths.length > 0 && readCount === childPaths.length;
    const isMixed = readCount > 0 && readCount < childPaths.length;
    return (
      <div className="tree-folder">
        <div className="tree-row folder-row" style={{ paddingLeft: 18 }}>
          <button className="tree-folder-button" onClick={() => onToggleFolder(node.path)}>
            {open ? <FolderOpen size={14} /> : <Folder size={14} />}
            <span>{node.name}</span>
          </button>
          <span className="tree-stats">
            <span className="positive">+{node.added}</span>
            <span className="negative">-{node.deleted}</span>
          </span>
          <input
            aria-checked={isMixed ? "mixed" : isChecked}
            aria-label={`Mark ${node.path} read`}
            checked={isChecked}
            className={isMixed ? "read-check mixed" : "read-check"}
            onChange={() => onToggleReadMany(childPaths, !isChecked)}
            type="checkbox"
          />
        </div>
        {open ? (
          <div className="tree-children">
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                readPaths={readPaths}
                collapsedFolders={collapsedFolders}
                onToggleFolder={onToggleFolder}
                selectedPath={selectedPath}
                onSelect={onSelect}
                onToggleRead={onToggleRead}
                onToggleReadMany={onToggleReadMany}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <FileRow
      file={node.file}
      readPaths={readPaths}
      selectedPath={selectedPath}
      onSelect={onSelect}
      onToggleRead={onToggleRead}
    />
  );
}

export const DEFAULT_SPLIT_WIDTH = 50;

const popoverGap = 6;
const popoverViewportPadding = 8;
const popoverShowDelayMs = 500;

function getPopoverStyle(anchor: DOMRect, popover: DOMRect): CSSProperties {
  const maxLeft = window.innerWidth - popover.width - popoverViewportPadding;
  const maxTop = window.innerHeight - popover.height - popoverViewportPadding;

  let top = anchor.bottom + popoverGap;
  if (top > maxTop && anchor.top - popoverGap - popover.height >= popoverViewportPadding) {
    top = anchor.top - popoverGap - popover.height;
  }
  top = Math.max(popoverViewportPadding, Math.min(top, maxTop));

  let left = anchor.left + anchor.width / 2 - popover.width / 2;
  left = Math.max(popoverViewportPadding, Math.min(left, maxLeft));

  return { left, top };
}

function DelayedPopover({ children, label }: { children: ReactNode; label: string }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const showTimerRef = useRef<number | undefined>(undefined);
  const [visible, setVisible] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!visible) {
      return;
    }

    function reposition() {
      const wrap = wrapRef.current;
      const popover = popoverRef.current;
      if (wrap == null || popover == null) {
        return;
      }

      setPopoverStyle(
        getPopoverStyle(wrap.getBoundingClientRect(), popover.getBoundingClientRect()),
      );
    }

    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [visible]);

  function showSoon() {
    window.clearTimeout(showTimerRef.current);
    showTimerRef.current = window.setTimeout(() => setVisible(true), popoverShowDelayMs);
  }

  function hide() {
    window.clearTimeout(showTimerRef.current);
    setVisible(false);
    setPopoverStyle(null);
  }

  return (
    <span
      className="toolbar-button-popover-wrap"
      onMouseEnter={showSoon}
      onMouseLeave={hide}
      ref={wrapRef}
    >
      {children}
      {visible ? (
        <span
          className={
            popoverStyle == null
              ? "toolbar-button-popover measuring"
              : "toolbar-button-popover visible"
          }
          ref={popoverRef}
          role="tooltip"
          style={popoverStyle ?? { left: -9999, top: -9999 }}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}

export function DiffPreviewList({
  collapsedPaths,
  comparison,
  leftWidth,
  mode,
  onOpenFile,
  onExpandContext,
  onResize,
  onSelect,
  onTogglePreview,
  onToggleRead,
  previews,
  readPaths,
  selectedPath,
}: {
  collapsedPaths: ReadonlySet<string>;
  comparison: DiffComparison;
  leftWidth: number;
  mode: ViewMode;
  onOpenFile(path: string): void;
  onExpandContext(path: string): void;
  onResize(width: number): void;
  onSelect(path: string): void;
  onTogglePreview(path: string): void;
  onToggleRead(path: string): void;
  previews: readonly DiffPreview[];
  readPaths: ReadonlySet<string>;
  selectedPath: string | null;
}) {
  const previewRefs = useRef(new Map<string, HTMLElement>());

  function togglePreview(path: string, isCollapsed: boolean) {
    onTogglePreview(path);
    if (isCollapsed) {
      return;
    }

    requestAnimationFrame(() => {
      const preview = previewRefs.current.get(path);
      preview?.scrollIntoView({ block: "start", inline: "nearest" });
    });
  }

  useEffect(() => {
    if (selectedPath == null) {
      return;
    }

    const selectedPreview = previewRefs.current.get(selectedPath);
    selectedPreview?.scrollIntoView({ block: "start", inline: "nearest" });
  }, [selectedPath, previews]);

  if (previews.length === 0) {
    return <section className="diff-empty">No changes</section>;
  }

  return (
    <section className="diff-body" style={getDiffBodyStyle(leftWidth)}>
      {previews.map((preview) => {
        const isCollapsed = collapsedPaths.has(preview.file.path);
        return (
          <section
            className={
              preview.file.path === selectedPath ? "file-preview selected" : "file-preview"
            }
            key={preview.file.path}
            ref={(element) => {
              if (element == null) {
                previewRefs.current.delete(preview.file.path);
              } else {
                previewRefs.current.set(preview.file.path, element);
              }
            }}
          >
            <header className="file-preview-header">
              <button
                className="preview-toggle"
                onClick={() => togglePreview(preview.file.path, isCollapsed)}
                title={isCollapsed ? "Expand file preview" : "Collapse file preview"}
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
              <input
                aria-label={`Mark ${preview.file.path} read`}
                checked={readPaths.has(preview.file.path)}
                className="read-check"
                onChange={() => onToggleRead(preview.file.path)}
                type="checkbox"
              />
              <FileCode2 size={15} />
              <button
                className="preview-file-button"
                onClick={() => onSelect(preview.file.path)}
                title={preview.file.path}
              >
                <strong>{getBasename(preview.file.path)}</strong>
              </button>
              <span className="file-dir">{getDirectory(preview.file.path)}</span>
              <span className="preview-stats">
                <span className="positive">+{preview.file.added}</span>
                <span className="negative">-{preview.file.deleted}</span>
              </span>
              <DelayedPopover label="Open File">
                <button
                  aria-label="Open file"
                  className="toolbar-button toolbar-button-icon"
                  onClick={() => onOpenFile(preview.file.path)}
                >
                  <ExternalLink size={14} />
                </button>
              </DelayedPopover>
            </header>
            {isCollapsed ? null : (
              <DiffView
                comparison={comparison}
                diffPreview={preview}
                leftWidth={leftWidth}
                mode={mode}
                onExpandContext={() => onExpandContext(preview.file.path)}
                onResize={onResize}
              />
            )}
          </section>
        );
      })}
    </section>
  );
}

function getDiffBodyStyle(leftWidth: number): DiffBodyStyle {
  return { "--split-width": `${leftWidth}%` };
}

function DiffView({
  comparison,
  diffPreview,
  leftWidth,
  mode,
  onExpandContext,
  onResize,
}: {
  comparison: DiffComparison;
  diffPreview: DiffPreview;
  leftWidth: number;
  mode: ViewMode;
  onExpandContext(): void;
  onResize(width: number): void;
}) {
  const [renderMode, setRenderMode] = useState<FileRenderMode>("preview");
  const readyDiff = diffPreview.type === "ready" ? diffPreview.diff : null;
  const imageKind = readyDiff == null ? null : getImagePreviewKind(readyDiff.path);
  const showingImagePreview =
    readyDiff != null && imageKind != null && (imageKind === "raster" || renderMode === "preview");
  const highlight = useDiffHighlight(showingImagePreview ? null : readyDiff);
  if (diffPreview.type === "loading") {
    return (
      <section className="hunk preview-hunk">
        <section className="preview-message">Loading diff</section>
      </section>
    );
  }
  if (diffPreview.type === "error") {
    return (
      <section className="hunk preview-hunk">
        <section className="preview-message">{diffPreview.message}</section>
      </section>
    );
  }
  const diff = diffPreview.diff;
  if (imageKind === "raster") {
    return (
      <ImageDiffPreview comparison={comparison} path={diff.path} previousPath={diff.previousPath} />
    );
  }
  if (imageKind === "svg" && renderMode === "preview") {
    return (
      <>
        <PreviewModeToggle mode={renderMode} onChange={setRenderMode} />
        <ImageDiffPreview
          comparison={comparison}
          path={diff.path}
          previousPath={diff.previousPath}
        />
      </>
    );
  }
  if (diff.isBinary) {
    return (
      <section className="hunk preview-hunk">
        <section className="preview-message">Binary file not shown.</section>
      </section>
    );
  }
  return (
    <>
      {imageKind === "svg" ? (
        <PreviewModeToggle mode={renderMode} onChange={setRenderMode} />
      ) : null}
      <HighlightContext.Provider value={highlight}>
        <DiffHunkList
          hunks={diff.hunks}
          leftWidth={leftWidth}
          mode={mode}
          onExpandContext={onExpandContext}
          onResize={onResize}
        />
      </HighlightContext.Provider>
    </>
  );
}

const HighlightContext = createContext<HighlightIndex>({ getTokens: () => null });

function PreviewModeToggle({
  mode,
  onChange,
}: {
  mode: FileRenderMode;
  onChange(mode: FileRenderMode): void;
}) {
  return (
    <div className="preview-mode-row">
      <div className="segmented" aria-label="SVG view">
        <button
          className={mode === "preview" ? "active" : ""}
          onClick={() => onChange("preview")}
          title="Preview"
        >
          <ImageIcon size={15} />
        </button>
        <button
          className={mode === "code" ? "active" : ""}
          onClick={() => onChange("code")}
          title="Code"
        >
          <Code2 size={15} />
        </button>
      </div>
    </div>
  );
}

function ImageDiffPreview({
  comparison,
  path,
  previousPath,
}: {
  comparison: DiffComparison;
  path: string;
  previousPath: string | null;
}) {
  const [state, setState] = useState<ImagePreviewState>({ type: "loading" });

  useEffect(() => {
    let active = true;
    setState({ type: "loading" });
    void window.ziff
      .getImagePreview({ path, previousPath, comparison })
      .then((preview) => {
        if (active) {
          setState({ type: "ready", preview });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({ type: "error", message: getErrorMessage(error) });
        }
      });

    return () => {
      active = false;
    };
  }, [comparison, path, previousPath]);

  if (state.type === "loading") {
    return (
      <section className="hunk preview-hunk">
        <section className="preview-message">Loading preview</section>
      </section>
    );
  }

  if (state.type === "error") {
    return (
      <section className="hunk preview-hunk">
        <section className="preview-message">{state.message}</section>
      </section>
    );
  }

  const sides = getImagePreviewSides(state.preview);
  if (sides.length === 0) {
    return (
      <section className="hunk preview-hunk">
        <section className="preview-message">Image preview unavailable.</section>
      </section>
    );
  }

  return (
    <section className={sides.length > 1 ? "image-preview split" : "image-preview"}>
      {sides.map((side) => (
        <figure className="image-preview-side" key={side.label}>
          <figcaption>{side.label}</figcaption>
          <div className="image-preview-frame">
            <img alt={`${side.label} ${path}`} src={side.dataUrl} />
          </div>
        </figure>
      ))}
    </section>
  );
}

// Split column widths are driven by the `--split-width` CSS variable set on the
// `.diff-body` container, so a drag updates every hunk at once without React
// touching a single row. `leftWidth` only changes here on release/reset, so
// memoizing keeps unrelated re-renders (e.g. the diff panel reflowing while the
// sidebar is dragged) from walking every row.
const HunkView = memo(function HunkView({
  hunk,
  leftWidth,
  mode,
  onResize,
}: {
  hunk: DiffHunk;
  leftWidth: number;
  mode: ViewMode;
  onResize(width: number): void;
}) {
  if (mode === "stacked") {
    return (
      <section className="hunk">
        {hunk.rows.flatMap((row, index) => renderStackedRow(row, index))}
      </section>
    );
  }

  return (
    <section className="hunk split-hunk">
      {hunk.rows.map((row, index) => (
        <SplitRow key={`${index}-${lineKey(row)}`} row={row} />
      ))}
      <SplitResizeHandle max={72} min={28} onResize={onResize} value={leftWidth} />
    </section>
  );
});

function DiffHunkList({
  hunks,
  leftWidth,
  mode,
  onExpandContext,
  onResize,
}: {
  hunks: readonly DiffHunk[];
  leftWidth: number;
  mode: ViewMode;
  onExpandContext(): void;
  onResize(width: number): void;
}) {
  const nodes: ReactNode[] = [];
  let previous: DiffHunk | null = null;

  hunks.forEach((hunk, index) => {
    const lineInfo = getHunkLineInfo(previous, hunk);
    if (lineInfo != null) {
      nodes.push(
        <HunkLineInfoSeparator
          key={`separator-${index}`}
          lineInfo={lineInfo}
          onExpandContext={onExpandContext}
        />,
      );
    }
    nodes.push(
      <HunkView
        key={`hunk-${index}-${hunk.header}`}
        hunk={hunk}
        leftWidth={leftWidth}
        mode={mode}
        onResize={onResize}
      />,
    );
    previous = hunk;
  });

  return nodes;
}

function HunkLineInfoSeparator({
  lineInfo,
  onExpandContext,
}: {
  lineInfo: HunkLineInfo;
  onExpandContext(): void;
}) {
  return (
    <section className="hunk hunk-line-info-separator">
      <button
        className="hunk-line-info"
        onClick={onExpandContext}
        title="Show more unchanged lines"
      >
        <span className="hunk-line-info-icon" aria-hidden="true">
          <ChevronsUpDown size={13} />
        </span>
        <span className="hunk-line-info-count">
          {formatter.format(lineInfo.collapsedLines)} unchanged{" "}
          {lineInfo.collapsedLines === 1 ? "line" : "lines"}
        </span>
        <span className="hunk-line-info-range">
          {formatHunkLineInfoRange("Old", lineInfo.oldRange)}
        </span>
        <span className="hunk-line-info-range">
          {formatHunkLineInfoRange("New", lineInfo.newRange)}
        </span>
      </button>
    </section>
  );
}

function getHunkLineInfo(previous: DiffHunk | null, next: DiffHunk): HunkLineInfo | null {
  const oldRange =
    previous == null
      ? getLeadingLineRange(next.oldStart)
      : getCollapsedLineRange(previous.oldStart + previous.oldLines, next.oldStart - 1);
  const newRange =
    previous == null
      ? getLeadingLineRange(next.newStart)
      : getCollapsedLineRange(previous.newStart + previous.newLines, next.newStart - 1);

  const collapsedLines = Math.max(getLineRangeLength(oldRange), getLineRangeLength(newRange));
  if (collapsedLines === 0) {
    return null;
  }

  return { collapsedLines, newRange, oldRange };
}

function getLeadingLineRange(nextStart: number): LineRange | null {
  return getCollapsedLineRange(1, nextStart - 1);
}

function getCollapsedLineRange(start: number, end: number): LineRange | null {
  if (start < 1 || end < start) {
    return null;
  }
  return { start, end };
}

function getLineRangeLength(range: LineRange | null): number {
  return range == null ? 0 : range.end - range.start + 1;
}

function formatHunkLineInfoRange(label: "New" | "Old", range: LineRange | null): string {
  if (range == null) {
    return `${label} -`;
  }
  if (range.start === range.end) {
    return `${label} ${formatter.format(range.start)}`;
  }
  return `${label} ${formatter.format(range.start)}-${formatter.format(range.end)}`;
}

function SplitResizeHandle({
  max,
  min,
  onResize,
  value,
}: {
  max: number;
  min: number;
  onResize(width: number): void;
  value: number;
}) {
  function startResize(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    const body = event.currentTarget.closest(".diff-body");
    if (bounds == null || bounds.width <= 0 || !(body instanceof HTMLElement)) {
      return;
    }
    startResizeDrag({
      apply: (next) => body.style.setProperty("--split-width", `${next}%`),
      commit: onResize,
      event,
      max,
      measure: (clientX) => ((clientX - bounds.left) / bounds.width) * 100,
      min,
    });
  }

  return (
    <div
      aria-label="Resize split diff"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      className="resize-slider"
      onDoubleClick={() => onResize(DEFAULT_SPLIT_WIDTH)}
      onPointerDown={startResize}
      role="separator"
      tabIndex={0}
    />
  );
}

function SplitRow({ row }: { row: SplitDiffRow }) {
  if (row.kind === "context") {
    return (
      <div className="split-row">
        <CodeCell side="old" tokenSide="old" line={row.oldLine} content={row.text} tone="context" />
        <CodeCell side="new" tokenSide="new" line={row.newLine} content={row.text} tone="context" />
      </div>
    );
  }
  if (row.kind === "delete") {
    return (
      <div className="split-row">
        <CodeCell side="old" tokenSide="old" line={row.oldLine} content={row.text} tone="delete" />
        <CodeCell side="new" line={null} content="" tone="empty" />
      </div>
    );
  }
  if (row.kind === "add") {
    return (
      <div className="split-row">
        <CodeCell side="old" line={null} content="" tone="empty" />
        <CodeCell side="new" tokenSide="new" line={row.newLine} content={row.text} tone="add" />
      </div>
    );
  }
  return (
    <div className="split-row">
      <CodeCell
        side="old"
        tokenSide="old"
        line={row.oldLine}
        content={row.oldText}
        tone="delete"
        wordFragments={getInlineFragments(row.oldText, row.newText, "old")}
      />
      <CodeCell
        side="new"
        tokenSide="new"
        line={row.newLine}
        content={row.newText}
        tone="add"
        wordFragments={getInlineFragments(row.oldText, row.newText, "new")}
      />
    </div>
  );
}

function renderStackedRow(row: SplitDiffRow, index: number) {
  if (row.kind === "context") {
    return [
      <CodeCell
        key={index}
        side="both"
        tokenSide="new"
        line={row.newLine}
        content={row.text}
        tone="context"
      />,
    ];
  }
  if (row.kind === "delete") {
    return [
      <CodeCell
        key={index}
        side="both"
        tokenSide="old"
        line={row.oldLine}
        content={row.text}
        prefix="- "
        tone="delete"
      />,
    ];
  }
  if (row.kind === "add") {
    return [
      <CodeCell
        key={index}
        side="both"
        tokenSide="new"
        line={row.newLine}
        content={row.text}
        prefix="+ "
        tone="add"
      />,
    ];
  }
  return [
    <CodeCell
      key={`${index}-old`}
      side="both"
      tokenSide="old"
      line={row.oldLine}
      content={row.oldText}
      prefix="- "
      tone="delete"
      wordFragments={getInlineFragments(row.oldText, row.newText, "old")}
    />,
    <CodeCell
      key={`${index}-new`}
      side="both"
      tokenSide="new"
      line={row.newLine}
      content={row.newText}
      prefix="+ "
      tone="add"
      wordFragments={getInlineFragments(row.oldText, row.newText, "new")}
    />,
  ];
}

type RenderSegment = {
  text: string;
  color?: string;
  highlighted: boolean;
};

function CodeCell({
  content,
  line,
  prefix,
  side,
  tokenSide,
  tone,
  wordFragments,
}: {
  content: string;
  line: number | null;
  prefix?: string;
  side: "old" | "new" | "both";
  tokenSide?: "old" | "new";
  tone: "add" | "context" | "delete" | "empty";
  wordFragments?: readonly RenderSegment[];
}) {
  const highlight = useContext(HighlightContext);
  const tokens = tokenSide != null && line != null ? highlight.getTokens(tokenSide, line) : null;
  const base: readonly RenderSegment[] = wordFragments ?? [{ text: content, highlighted: false }];
  const segments = tokens != null ? mergeSyntax(content, tokens, base) : base;
  const rendered = prefix != null ? [{ text: prefix, highlighted: false }, ...segments] : segments;
  return (
    <div className={`code-cell ${side} ${tone}`}>
      <span className="line-number">{line ?? ""}</span>
      <code>
        {rendered.map((segment, index) => (
          <span
            className={segment.highlighted ? "text-highlight" : undefined}
            key={`${index}-${segment.text}`}
            style={segment.color != null ? { color: segment.color } : undefined}
          >
            {segment.text}
          </span>
        ))}
      </code>
    </div>
  );
}

function getImagePreviewSides(preview: ImagePreview): readonly RenderImagePreviewSide[] {
  const sides: RenderImagePreviewSide[] = [];
  if (preview.before != null) {
    sides.push({ dataUrl: preview.before.dataUrl, label: "Before" });
  }
  if (preview.after != null) {
    sides.push({ dataUrl: preview.after.dataUrl, label: "After" });
  }
  return sides;
}

function getImagePreviewKind(path: string): ImagePreviewKind | null {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith(".svg")) {
    return "svg";
  }
  if (
    lowerPath.endsWith(".avif") ||
    lowerPath.endsWith(".gif") ||
    lowerPath.endsWith(".jpeg") ||
    lowerPath.endsWith(".jpg") ||
    lowerPath.endsWith(".png") ||
    lowerPath.endsWith(".webp")
  ) {
    return "raster";
  }
  return null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

function toggleMenu(current: HeaderMenu | null, next: HeaderMenu): HeaderMenu | null {
  return current === next ? null : next;
}
