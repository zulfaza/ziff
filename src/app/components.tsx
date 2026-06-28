import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Code2,
  Columns2,
  Copy,
  Edit3,
  ExternalLink,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  GitFork,
  ImageIcon,
  MessageSquare,
  Monitor,
  Plus,
  Rows3,
  Search,
  SlidersHorizontal,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type RefObject,
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
import { getAnnotationAnchorKey, isLineInAnnotationRange } from "../annotations";
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
import { resolveHeaderHotkey } from "./hotkeys";
import { type HighlightIndex, useDiffHighlight } from "./highlighter";
import type {
  DiffPreview,
  FileGroupBy,
  FileListView,
  FileTreeNode,
  HeaderMenu,
  RecentProject,
  SidebarTab,
} from "./types";
import type {
  Annotation,
  AnnotationAnchor,
  AnnotationAuthor,
  AnnotationKind,
  AnnotationSide,
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

type AnnotationFilterKind = AnnotationKind | "all";

type AnnotationFilterStatus = "all" | "open";

type AnnotationSelectionMode = "extend" | "range" | "replace";

interface AnnotationClickEvent {
  shiftKey: boolean;
}

interface AnnotationDragState {
  candidates: readonly AnnotationDragCandidate[];
  finalAnchor: AnnotationAnchor;
  frameId: number | null;
  file: string;
  lastLine: number;
  mode: AnnotationSelectionMode;
  pendingPosition: PointerPosition | null;
  pointerId: number;
  previewElements: Set<HTMLElement>;
  side: AnnotationSide;
  startLine: number;
}

interface AnnotationDragCandidate {
  cell: HTMLElement;
  line: number;
}

interface PointerPosition {
  clientX: number;
  clientY: number;
}

interface AnnotationDragController {
  end(pointerId: number): void;
  enter(anchor: AnnotationAnchor): void;
  move(clientX: number, clientY: number, pointerId: number): void;
  start(anchor: AnnotationAnchor, pointerId: number, mode: AnnotationSelectionMode): void;
}

type AnnotationEditorState =
  | { type: "create"; anchor: AnnotationAnchor; kind: AnnotationKind }
  | { type: "edit"; annotation: Annotation };

interface AnnotationActions {
  onDelete(id: string): void;
  onEdit(annotation: Annotation): void;
  onSelect(annotation: Annotation): void;
  onToggleResolved(annotation: Annotation): void;
}

const formatter = new Intl.NumberFormat("en-US");
const recentBranchLimit = 8;
const AnnotationDragContext = createContext<AnnotationDragController | null>(null);

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
  onChooseRepo,
  onForgetProject,
  onOpenProjectWindow,
  onSwitchBranch,
  onSwitchProject,
  onSwitchWorktree,
  recentProjects,
  snapshot,
}: {
  onChooseRepo(): void;
  onForgetProject(path: string): void;
  onOpenProjectWindow(path: string): void;
  onSwitchBranch(branch: string): void;
  onSwitchProject(path: string): void;
  onSwitchWorktree(path: string): void;
  recentProjects: readonly RecentProject[];
  snapshot: RepoSnapshot;
}) {
  const [menu, setMenu] = useState<HeaderMenu | null>(null);
  const info = snapshot.info;

  useEffect(() => {
    function closeMenu(event: MouseEvent) {
      if (event.target instanceof Element && event.target.closest(".header-menu-wrap") != null) {
        return;
      }
      setMenu(null);
    }

    window.addEventListener("mousedown", closeMenu);
    return () => window.removeEventListener("mousedown", closeMenu);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && menu != null) {
        event.preventDefault();
        setMenu(null);
        return;
      }

      const action = resolveHeaderHotkey(event);
      if (action == null) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setMenu(headerHotkeyToMenu(action));
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [menu]);

  function closeMenuAndRun(action: () => void) {
    setMenu(null);
    action();
  }

  return (
    <nav className="repo-header" aria-label="Repository">
      <HeaderSelector
        active={menu === "project"}
        kind="project"
        label={info.projectName}
        onClick={() => setMenu(toggleMenu(menu, "project"))}
      >
        {menu === "project" ? (
          <ProjectMenu
            currentPath={info.path}
            projects={recentProjects}
            onChooseRepo={() => closeMenuAndRun(onChooseRepo)}
            onForgetProject={onForgetProject}
            onOpenProjectWindow={(path) => closeMenuAndRun(() => onOpenProjectWindow(path))}
            onSwitchProject={(path) => closeMenuAndRun(() => onSwitchProject(path))}
          />
        ) : null}
      </HeaderSelector>
      <HeaderSelector
        active={menu === "worktree"}
        icon={<GitFork size={15} />}
        kind="meta"
        label={info.worktree}
        onClick={() => setMenu(toggleMenu(menu, "worktree"))}
      >
        {menu === "worktree" ? (
          <WorktreeMenu
            worktrees={info.worktrees}
            onSwitchWorktree={(path) => closeMenuAndRun(() => onSwitchWorktree(path))}
          />
        ) : null}
      </HeaderSelector>
      <span className="header-slash">/</span>
      <HeaderSelector
        active={menu === "branch"}
        icon={<GitBranch size={15} />}
        kind="meta"
        label={info.branch}
        onClick={() => setMenu(toggleMenu(menu, "branch"))}
      >
        {menu === "branch" ? (
          <BranchMenu
            branches={info.branches}
            onSwitchBranch={(branch) => closeMenuAndRun(() => onSwitchBranch(branch))}
          />
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
  onSwitchWorktree,
  worktrees,
}: {
  onSwitchWorktree(path: string): void;
  worktrees: readonly WorktreeEntry[];
}) {
  const [query, setQuery] = useState("");
  const filteredWorktrees = worktrees.filter((worktree) =>
    worktree.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="header-menu worktree-menu">
      <SearchField onChange={setQuery} placeholder="Search worktrees..." value={query} />
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
      <SearchField
        onChange={setQuery}
        placeholder="Switch or type to create a branch..."
        value={query}
      />
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

export const Sidebar = memo(function Sidebar({
  annotationKind,
  annotations,
  comparison,
  fileGroupBy,
  fileListView,
  onAnnotationKindChange,
  onChangeComparison,
  onCopyPrompt,
  onDeleteAnnotation,
  onEditAnnotation,
  onFileGroupByChange,
  onFileListViewChange,
  onSelectAnnotation,
  onSelectPath,
  onToggleAnnotationResolved,
  onToggleRead,
  onToggleReadMany,
  onViewDiff,
  readPaths,
  selectedAnnotationId,
  selectedPath,
  snapshot,
  totalsAdded,
  totalsDeleted,
  visible,
}: {
  annotationKind: AnnotationKind;
  annotations: readonly Annotation[];
  comparison: DiffComparison;
  fileGroupBy: FileGroupBy;
  fileListView: FileListView;
  onAnnotationKindChange(kind: AnnotationKind): void;
  onChangeComparison(comparison: DiffComparison): void;
  onCopyPrompt(annotations: readonly Annotation[]): void;
  onDeleteAnnotation(id: string): void;
  onEditAnnotation(annotation: Annotation): void;
  onFileGroupByChange(groupBy: FileGroupBy): void;
  onFileListViewChange(view: FileListView): void;
  onSelectAnnotation(annotation: Annotation): void;
  onSelectPath(path: string): void;
  onToggleAnnotationResolved(annotation: Annotation): void;
  onToggleRead(path: string): void;
  onToggleReadMany(paths: readonly string[], read: boolean): void;
  onViewDiff(): void;
  readPaths: ReadonlySet<string>;
  selectedAnnotationId: string | null;
  selectedPath: string | null;
  snapshot: RepoSnapshot;
  totalsAdded: number;
  totalsDeleted: number;
  visible: boolean;
}) {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("changes");
  const [commits, setCommits] = useState<readonly CommitEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (sidebarTab !== "history") {
      return;
    }

    let active = true;
    setHistoryLoading(true);
    void window.ziff
      .getHistory()
      .then((nextCommits) => {
        if (active) {
          setCommits(nextCommits);
        }
      })
      .finally(() => {
        if (active) {
          setHistoryLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [snapshot, sidebarTab]);

  return (
    <aside
      aria-hidden={!visible}
      className={sidebarTab === "changes" ? "sidebar" : "sidebar single-panel-active"}
      inert={!visible}
    >
      <section className="sidebar-tabs">
        <button
          className={sidebarTab === "changes" ? "tab active" : "tab"}
          onClick={() => setSidebarTab("changes")}
        >
          Changes ({snapshot.files.length})
        </button>
        <button
          className={sidebarTab === "history" ? "tab active" : "tab"}
          onClick={() => setSidebarTab("history")}
        >
          History
        </button>
        <button
          className={sidebarTab === "annotations" ? "tab active" : "tab"}
          onClick={() => setSidebarTab("annotations")}
        >
          Notes ({annotations.length})
        </button>
      </section>
      {sidebarTab === "changes" ? (
        <ChangesPanel
          files={snapshot.files}
          fileGroupBy={fileGroupBy}
          fileListView={fileListView}
          readPaths={readPaths}
          selectedPath={selectedPath}
          totalsAdded={totalsAdded}
          totalsDeleted={totalsDeleted}
          onFileGroupByChange={onFileGroupByChange}
          onFileListViewChange={onFileListViewChange}
          onSelect={onSelectPath}
          onToggleRead={onToggleRead}
          onToggleReadMany={onToggleReadMany}
          onViewDiff={onViewDiff}
        />
      ) : sidebarTab === "history" ? (
        <HistoryList
          activeHash={comparison.type === "commit" ? comparison.hash : null}
          commits={commits}
          loading={historyLoading}
          onSelectCommit={(hash) => onChangeComparison({ type: "commit", hash })}
        />
      ) : (
        <AnnotationsPanel
          annotationKind={annotationKind}
          annotations={annotations}
          selectedAnnotationId={selectedAnnotationId}
          selectedPath={selectedPath}
          onAnnotationKindChange={onAnnotationKindChange}
          onCopyPrompt={onCopyPrompt}
          onDelete={onDeleteAnnotation}
          onEdit={onEditAnnotation}
          onSelect={onSelectAnnotation}
          onToggleResolved={onToggleAnnotationResolved}
        />
      )}
    </aside>
  );
});

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

export function AnnotationsPanel({
  annotationKind,
  annotations,
  onAnnotationKindChange,
  onCopyPrompt,
  onDelete,
  onEdit,
  onSelect,
  onToggleResolved,
  selectedAnnotationId,
  selectedPath,
}: {
  annotationKind: AnnotationKind;
  annotations: readonly Annotation[];
  onAnnotationKindChange(kind: AnnotationKind): void;
  onCopyPrompt(annotations: readonly Annotation[]): void;
  onDelete(id: string): void;
  onEdit(annotation: Annotation): void;
  onSelect(annotation: Annotation): void;
  onToggleResolved(annotation: Annotation): void;
  selectedAnnotationId: string | null;
  selectedPath: string | null;
}) {
  const [kindFilter, setKindFilter] = useState<AnnotationFilterKind>("all");
  const [statusFilter, setStatusFilter] = useState<AnnotationFilterStatus>("open");
  const [currentFileOnly, setCurrentFileOnly] = useState(false);
  const visibleAnnotations = useMemo(
    () =>
      annotations.filter((annotation) => {
        if (kindFilter !== "all" && annotation.kind !== kindFilter) {
          return false;
        }
        if (statusFilter === "open" && annotation.status.state !== "open") {
          return false;
        }
        return !currentFileOnly || selectedPath == null || annotation.file === selectedPath;
      }),
    [annotations, currentFileOnly, kindFilter, selectedPath, statusFilter],
  );

  return (
    <section className="annotations-panel">
      <div className="annotation-filters">
        <div className="segmented annotation-kind-switch" aria-label="New note kind">
          <button
            className={annotationKind === "review" ? "active" : ""}
            onClick={() => onAnnotationKindChange("review")}
            title="Review note"
            type="button"
          >
            <MessageSquare size={14} />
          </button>
          <button
            className={annotationKind === "agent-prompt" ? "active" : ""}
            onClick={() => onAnnotationKindChange("agent-prompt")}
            title="Agent prompt"
            type="button"
          >
            <Bot size={14} />
          </button>
        </div>
        <select
          aria-label="Annotation kind"
          onChange={(event) => setKindFilter(parseKindFilter(event.currentTarget.value))}
          value={kindFilter}
        >
          <option value="all">All kinds</option>
          <option value="review">Review</option>
          <option value="agent-prompt">Agent prompts</option>
        </select>
        <select
          aria-label="Annotation status"
          onChange={(event) => setStatusFilter(parseStatusFilter(event.currentTarget.value))}
          value={statusFilter}
        >
          <option value="open">Open</option>
          <option value="all">All status</option>
        </select>
        <label className="annotation-current-file">
          <input
            checked={currentFileOnly}
            disabled={selectedPath == null}
            onChange={() => setCurrentFileOnly((current) => !current)}
            type="checkbox"
          />
          File
        </label>
        <button
          className="icon-button"
          disabled={visibleAnnotations.length === 0}
          onClick={() => onCopyPrompt(visibleAnnotations)}
          title="Copy prompt"
        >
          <Copy size={14} />
        </button>
      </div>
      <div className="annotation-list">
        {visibleAnnotations.length === 0 ? (
          <p className="annotation-empty">No annotations</p>
        ) : (
          visibleAnnotations.map((annotation) => (
            <AnnotationListItem
              annotation={annotation}
              key={annotation.id}
              selected={annotation.id === selectedAnnotationId}
              onDelete={onDelete}
              onEdit={onEdit}
              onSelect={onSelect}
              onToggleResolved={onToggleResolved}
            />
          ))
        )}
      </div>
    </section>
  );
}

function parseKindFilter(value: string): AnnotationFilterKind {
  return value === "review" || value === "agent-prompt" ? value : "all";
}

function parseStatusFilter(value: string): AnnotationFilterStatus {
  return value === "all" ? "all" : "open";
}

function AnnotationListItem({
  annotation,
  onDelete,
  onEdit,
  onSelect,
  onToggleResolved,
  selected,
}: AnnotationActions & {
  annotation: Annotation;
  selected: boolean;
}) {
  return (
    <article className={selected ? "annotation-list-item selected" : "annotation-list-item"}>
      <button className="annotation-list-main" onClick={() => onSelect(annotation)}>
        <span className="annotation-list-title">
          <AnnotationKindIcon kind={annotation.kind} />
          <span>{annotation.file}</span>
        </span>
        <span className="annotation-list-meta">
          {annotation.side} {formatAnnotationLineRange(annotation)} ·{" "}
          {formatAnnotationKind(annotation.kind)}
          {annotation.status.state === "resolved" ? " · resolved" : ""}
        </span>
        <span className="annotation-list-body">{annotation.body}</span>
      </button>
      <AnnotationActionButtons
        annotation={annotation}
        onDelete={onDelete}
        onEdit={onEdit}
        onToggleResolved={onToggleResolved}
      />
    </article>
  );
}

function InlineAnnotationCard({
  annotation,
  onSelect,
  onToggleResolved,
  selected,
}: AnnotationActions & {
  annotation: Annotation;
  selected: boolean;
}) {
  return (
    <article
      className={selected ? "annotation-thread selected" : "annotation-thread"}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(annotation);
      }}
    >
      <div className="annotation-comment">
        <AnnotationAvatar author={annotation.author} />
        <div className="annotation-comment-body">
          <div className="annotation-comment-meta">
            <strong>{annotation.author?.name ?? "You"}</strong>
            <span>{formatAnnotationTime(annotation.createdAt)}</span>
            <span>{formatAnnotationKind(annotation.kind)}</span>
          </div>
          <p>{annotation.body}</p>
        </div>
      </div>
      <div className="annotation-thread-actions">
        <button className="annotation-thread-link" type="button">
          <CornerDownRightIcon />
          Add reply...
        </button>
        <button
          className="annotation-thread-link"
          onClick={(event) => {
            event.stopPropagation();
            onToggleResolved(annotation);
          }}
          type="button"
        >
          {annotation.status.state === "open" ? "Resolve" : "Reopen"}
        </button>
      </div>
    </article>
  );
}

function InlineAnnotationEditor({
  author,
  onCancel,
  onSave,
  state,
}: {
  author: AnnotationAuthor;
  onCancel(): void;
  onSave(kind: AnnotationKind, body: string): void;
  state: AnnotationEditorState;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [kind, setKind] = useState<AnnotationKind>("review");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (state.type === "edit") {
      setKind(state.annotation.kind);
      setBody(state.annotation.body);
    } else {
      setKind(state.kind);
      setBody("");
    }

    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [state]);

  const canSave = body.trim().length > 0;

  return (
    <div
      className="annotation-composer-wrap"
      onClick={(event) => event.stopPropagation()}
      role="presentation"
    >
      <div className="annotation-composer">
        <AnnotationAvatar author={author} />
        <div className="annotation-composer-main">
          <textarea
            ref={textareaRef}
            onChange={(event) => setBody(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canSave) {
                event.preventDefault();
                onSave(kind, body);
              }
            }}
            placeholder={
              kind === "agent-prompt" ? "Tell the agent what to do..." : "Leave a comment"
            }
            rows={3}
            value={body}
          />
          <div className="annotation-composer-footer">
            <button
              className="annotation-submit-button"
              disabled={!canSave}
              onClick={() => onSave(kind, body)}
              type="button"
            >
              Comment
            </button>
            <button className="annotation-cancel-button" onClick={onCancel} type="button">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnnotationActionButtons({
  annotation,
  onDelete,
  onEdit,
  onToggleResolved,
}: {
  annotation: Annotation;
  onDelete(id: string): void;
  onEdit(annotation: Annotation): void;
  onToggleResolved(annotation: Annotation): void;
}) {
  return (
    <div className="annotation-actions">
      <button
        aria-label={annotation.status.state === "open" ? "Resolve annotation" : "Reopen annotation"}
        className="icon-button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleResolved(annotation);
        }}
        title={annotation.status.state === "open" ? "Resolve" : "Reopen"}
      >
        <Check size={13} />
      </button>
      <button
        aria-label="Edit annotation"
        className="icon-button"
        onClick={(event) => {
          event.stopPropagation();
          onEdit(annotation);
        }}
        title="Edit"
      >
        <Edit3 size={13} />
      </button>
      <button
        aria-label="Delete annotation"
        className="icon-button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(annotation.id);
        }}
        title="Delete"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function AnnotationAvatar({ author }: { author?: AnnotationAuthor }) {
  const [imageFailed, setImageFailed] = useState(false);
  const avatarUrl = imageFailed ? null : (author?.avatarUrl ?? null);
  if (avatarUrl != null) {
    return (
      <img
        alt=""
        className="annotation-avatar"
        onError={() => setImageFailed(true)}
        src={avatarUrl}
      />
    );
  }
  const label = author?.name ?? "You";
  return (
    <span className="annotation-avatar" aria-hidden="true">
      {label.slice(0, 1)}
    </span>
  );
}

function CornerDownRightIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 16 16" width="14">
      <path
        d="M4 3v4.5A2.5 2.5 0 0 0 6.5 10H12m0 0-3-3m3 3-3 3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function formatAnnotationTime(createdAt: string): string {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) {
    return "now";
  }
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (elapsedMinutes < 1) {
    return "now";
  }
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m`;
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h`;
  }
  return `${Math.floor(elapsedHours / 24)}d`;
}

function formatAnnotationLineRange(annotation: Annotation): string {
  return annotation.lineStart === annotation.lineEnd
    ? `L${annotation.lineStart}`
    : `L${annotation.lineStart}-${annotation.lineEnd}`;
}

function AnnotationKindIcon({ kind }: { kind: AnnotationKind }) {
  return kind === "agent-prompt" ? <Bot size={13} /> : <MessageSquare size={13} />;
}

function formatAnnotationKind(kind: AnnotationKind): string {
  return kind === "agent-prompt" ? "Agent prompt" : "Review";
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

export const DiffPanel = memo(function DiffPanel({
  allCollapsed,
  annotationAuthor,
  annotationEditor,
  annotations,
  collapsedPaths,
  comparison,
  diffPanelRef,
  effectiveViewMode,
  info,
  isDiffPanelNarrow,
  leftWidth,
  onAddAnnotation,
  onCancelAnnotation,
  onChangeComparison,
  onDeleteAnnotation,
  onEditAnnotation,
  onExpandContext,
  onOpenFile,
  onResize,
  onSaveAnnotation,
  onSelect,
  onSelectAnnotation,
  onToggleAnnotationResolved,
  onToggleAllPreviews,
  onTogglePreview,
  onToggleRead,
  onViewModeChange,
  previewPaths,
  previews,
  readPaths,
  selectedAnnotationId,
  selectedPath,
}: {
  allCollapsed: boolean;
  annotationAuthor: AnnotationAuthor;
  annotationEditor: AnnotationEditorState | null;
  annotations: readonly Annotation[];
  collapsedPaths: ReadonlySet<string>;
  comparison: DiffComparison;
  diffPanelRef: RefObject<HTMLElement | null>;
  effectiveViewMode: ViewMode;
  info: RepoInfo;
  isDiffPanelNarrow: boolean;
  leftWidth: number;
  onAddAnnotation(anchor: AnnotationAnchor, mode: AnnotationSelectionMode): void;
  onCancelAnnotation(): void;
  onChangeComparison(comparison: DiffComparison): void;
  onDeleteAnnotation(id: string): void;
  onEditAnnotation(annotation: Annotation): void;
  onExpandContext(path: string): void;
  onOpenFile(path: string): void;
  onResize(width: number): void;
  onSaveAnnotation(kind: AnnotationKind, body: string): void;
  onSelect(path: string): void;
  onSelectAnnotation(annotation: Annotation): void;
  onToggleAnnotationResolved(annotation: Annotation): void;
  onToggleAllPreviews(): void;
  onTogglePreview(path: string): void;
  onToggleRead(path: string): void;
  onViewModeChange(mode: ViewMode): void;
  previewPaths: readonly string[];
  previews: readonly DiffPreview[];
  readPaths: ReadonlySet<string>;
  selectedAnnotationId: string | null;
  selectedPath: string | null;
}) {
  return (
    <section className="diff-panel" ref={diffPanelRef}>
      <div className="diff-toolbar">
        <button
          className="icon-button"
          disabled={previewPaths.length === 0}
          title={allCollapsed ? "Expand previews" : "Collapse previews"}
          onClick={onToggleAllPreviews}
        >
          {allCollapsed ? <ChevronsUpDown size={16} /> : <ChevronsDownUp size={16} />}
        </button>
        <div className="segmented" aria-label="Diff layout">
          <button
            className={effectiveViewMode === "stacked" ? "active" : ""}
            onClick={() => onViewModeChange("stacked")}
            title="Stacked diff"
          >
            <Rows3 size={16} />
          </button>
          <button
            className={effectiveViewMode === "split" ? "active" : ""}
            disabled={isDiffPanelNarrow}
            onClick={() => onViewModeChange("split")}
            title={isDiffPanelNarrow ? "Split diff needs more width" : "Split diff"}
          >
            <Columns2 size={16} />
          </button>
        </div>
        <div className="toolbar-spacer" />
        <ComparisonControls comparison={comparison} info={info} onChange={onChangeComparison} />
      </div>
      <DiffPreviewList
        annotationAuthor={annotationAuthor}
        previews={previews}
        annotationEditor={annotationEditor}
        annotations={annotations}
        collapsedPaths={collapsedPaths}
        comparison={comparison}
        readPaths={readPaths}
        selectedAnnotationId={selectedAnnotationId}
        selectedPath={selectedPath}
        leftWidth={leftWidth}
        mode={effectiveViewMode}
        onAddAnnotation={onAddAnnotation}
        onCancelAnnotation={onCancelAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        onEditAnnotation={onEditAnnotation}
        onOpenFile={onOpenFile}
        onExpandContext={onExpandContext}
        onResize={onResize}
        onSelectAnnotation={onSelectAnnotation}
        onSaveAnnotation={onSaveAnnotation}
        onSelect={onSelect}
        onToggleAnnotationResolved={onToggleAnnotationResolved}
        onTogglePreview={onTogglePreview}
        onToggleRead={onToggleRead}
      />
    </section>
  );
});

export const DiffPreviewList = memo(function DiffPreviewList({
  annotationAuthor,
  annotationEditor,
  annotations,
  collapsedPaths,
  comparison,
  leftWidth,
  mode,
  onAddAnnotation,
  onCancelAnnotation,
  onDeleteAnnotation,
  onEditAnnotation,
  onOpenFile,
  onExpandContext,
  onResize,
  onSelectAnnotation,
  onSaveAnnotation,
  onSelect,
  onToggleAnnotationResolved,
  onTogglePreview,
  onToggleRead,
  previews,
  readPaths,
  selectedAnnotationId,
  selectedPath,
}: {
  annotationAuthor: AnnotationAuthor;
  annotationEditor: AnnotationEditorState | null;
  annotations: readonly Annotation[];
  collapsedPaths: ReadonlySet<string>;
  comparison: DiffComparison;
  leftWidth: number;
  mode: ViewMode;
  onAddAnnotation(anchor: AnnotationAnchor, mode: AnnotationSelectionMode): void;
  onCancelAnnotation(): void;
  onDeleteAnnotation(id: string): void;
  onEditAnnotation(annotation: Annotation): void;
  onOpenFile(path: string): void;
  onExpandContext(path: string): void;
  onResize(width: number): void;
  onSelectAnnotation(annotation: Annotation): void;
  onSaveAnnotation(kind: AnnotationKind, body: string): void;
  onSelect(path: string): void;
  onToggleAnnotationResolved(annotation: Annotation): void;
  onTogglePreview(path: string): void;
  onToggleRead(path: string): void;
  previews: readonly DiffPreview[];
  readPaths: ReadonlySet<string>;
  selectedAnnotationId: string | null;
  selectedPath: string | null;
}) {
  const previewRefs = useRef(new Map<string, HTMLElement>());
  const [annotationDragActive, setAnnotationDragActive] = useState(false);
  const annotationDragRef = useRef<AnnotationDragState | null>(null);
  const scrollAnchorRef = useRef<{
    element: HTMLElement;
    scrollContainer: HTMLElement;
    top: number;
  } | null>(null);
  const annotationsByAnchor = useMemo(() => groupAnnotationsByAnchor(annotations), [annotations]);
  const annotationDragController = useMemo<AnnotationDragController>(
    () => ({
      end(pointerId) {
        const active = annotationDragRef.current;
        if (active?.pointerId === pointerId) {
          if (active.frameId != null) {
            window.cancelAnimationFrame(active.frameId);
          }
          clearAnnotationDragPreview(active);
          annotationDragRef.current = null;
          onAddAnnotation(active.finalAnchor, active.mode === "extend" ? "extend" : "range");
        }
        setAnnotationDragActive(false);
      },
      enter(anchor) {
        const active = annotationDragRef.current;
        if (active == null || active.file !== anchor.file || active.side !== anchor.side) {
          return;
        }
        if (active.lastLine === anchor.lineStart) {
          return;
        }
        active.lastLine = anchor.lineStart;
        active.finalAnchor = getAnnotationDragRange(active, anchor);
        renderAnnotationDragPreview(active);
      },
      move(clientX, clientY, pointerId) {
        const active = annotationDragRef.current;
        if (active == null || active.pointerId !== pointerId) {
          return;
        }
        active.pendingPosition = { clientX, clientY };
        if (active.frameId != null) {
          return;
        }
        active.frameId = window.requestAnimationFrame(() => {
          const latest = annotationDragRef.current;
          if (latest == null || latest.pointerId !== pointerId) {
            return;
          }
          latest.frameId = null;
          const position = latest.pendingPosition;
          latest.pendingPosition = null;
          if (position == null) {
            return;
          }
          const target = document.elementFromPoint(position.clientX, position.clientY);
          if (target == null) {
            return;
          }
          const anchor = getAnnotationAnchorFromGutterTarget(target);
          if (anchor == null || anchor.file !== latest.file || anchor.side !== latest.side) {
            return;
          }
          if (latest.lastLine === anchor.lineStart) {
            return;
          }
          latest.lastLine = anchor.lineStart;
          latest.finalAnchor = getAnnotationDragRange(latest, anchor);
          renderAnnotationDragPreview(latest);
        });
      },
      start(anchor, pointerId, mode) {
        const nextDrag: AnnotationDragState = {
          candidates: collectAnnotationDragCandidates(anchor),
          finalAnchor: anchor,
          frameId: null,
          file: anchor.file,
          lastLine: anchor.lineStart,
          mode,
          pendingPosition: null,
          pointerId,
          previewElements: new Set(),
          side: anchor.side,
          startLine: anchor.lineStart,
        };
        annotationDragRef.current = nextDrag;
        setAnnotationDragActive(true);
        renderAnnotationDragPreview(nextDrag);
      },
    }),
    [onAddAnnotation],
  );

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

  useLayoutEffect(() => {
    const anchor = scrollAnchorRef.current;
    if (anchor == null) {
      return;
    }

    scrollAnchorRef.current = null;
    anchor.scrollContainer.scrollTop += anchor.element.getBoundingClientRect().top - anchor.top;
  }, [previews]);

  useEffect(() => {
    if (selectedPath == null) {
      return;
    }

    const selectedPreview = previewRefs.current.get(selectedPath);
    selectedPreview?.scrollIntoView({ block: "start", inline: "nearest" });
  }, [selectedPath]);

  function expandContext(path: string, anchorElement: HTMLElement) {
    const scrollContainer = anchorElement.closest(".diff-body");
    if (scrollContainer instanceof HTMLElement) {
      scrollAnchorRef.current = {
        element: anchorElement,
        scrollContainer,
        top: anchorElement.getBoundingClientRect().top,
      };
    }
    onExpandContext(path);
  }

  if (previews.length === 0) {
    return <section className="diff-empty">No changes</section>;
  }

  return (
    <AnnotationDragContext.Provider value={annotationDragController}>
      <section
        className={annotationDragActive ? "diff-body annotation-dragging" : "diff-body"}
        style={getDiffBodyStyle(leftWidth)}
      >
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
                  annotationEditor={annotationEditor}
                  annotationAuthor={annotationAuthor}
                  annotationsByAnchor={annotationsByAnchor}
                  comparison={comparison}
                  diffPreview={preview}
                  leftWidth={leftWidth}
                  mode={mode}
                  onAddAnnotation={onAddAnnotation}
                  onCancelAnnotation={onCancelAnnotation}
                  onDeleteAnnotation={onDeleteAnnotation}
                  onEditAnnotation={onEditAnnotation}
                  onExpandContext={(anchorElement) =>
                    expandContext(preview.file.path, anchorElement)
                  }
                  onResize={onResize}
                  onSelectAnnotation={onSelectAnnotation}
                  onSaveAnnotation={onSaveAnnotation}
                  onToggleAnnotationResolved={onToggleAnnotationResolved}
                  selectedAnnotationId={selectedAnnotationId}
                />
              )}
            </section>
          );
        })}
      </section>
    </AnnotationDragContext.Provider>
  );
});

function groupAnnotationsByAnchor(
  annotations: readonly Annotation[],
): ReadonlyMap<string, readonly Annotation[]> {
  const groups = new Map<string, Annotation[]>();
  for (const annotation of annotations) {
    for (let line = annotation.lineStart; line <= annotation.lineEnd; line += 1) {
      const key = getAnnotationAnchorKey(annotation.file, line, annotation.side);
      const existing = groups.get(key);
      if (existing == null) {
        groups.set(key, [annotation]);
      } else {
        existing.push(annotation);
      }
    }
  }
  return groups;
}

function getAnnotationDragRange(
  active: AnnotationDragState,
  anchor: AnnotationAnchor,
): AnnotationAnchor {
  return {
    file: active.file,
    lineStart: Math.min(active.startLine, anchor.lineStart),
    lineEnd: Math.max(active.startLine, anchor.lineStart),
    side: active.side,
  };
}

function renderAnnotationDragPreview(active: AnnotationDragState): void {
  clearAnnotationDragPreview(active);
  const start = active.finalAnchor.lineStart;
  const end = active.finalAnchor.lineEnd;
  for (const candidate of active.candidates) {
    if (candidate.line < start || candidate.line > end) {
      continue;
    }
    candidate.cell.classList.add("annotation-drag-preview");
    active.previewElements.add(candidate.cell);
  }
}

function clearAnnotationDragPreview(active: AnnotationDragState): void {
  for (const element of active.previewElements) {
    element.classList.remove("annotation-drag-preview");
  }
  active.previewElements.clear();
}

function collectAnnotationDragCandidates(
  anchor: AnnotationAnchor,
): readonly AnnotationDragCandidate[] {
  const candidates: AnnotationDragCandidate[] = [];
  const gutters = document.querySelectorAll(".line-number[data-annotation-line]");
  for (const gutter of gutters) {
    if (!(gutter instanceof HTMLElement)) {
      continue;
    }
    const file = gutter.getAttribute("data-annotation-file");
    const line = parseAnnotationGutterLine(gutter.getAttribute("data-annotation-line"));
    const side = parseAnnotationGutterSide(gutter.getAttribute("data-annotation-side"));
    if (file !== anchor.file || side !== anchor.side || line == null) {
      continue;
    }
    const cell = gutter.closest(".code-cell");
    if (cell instanceof HTMLElement) {
      candidates.push({ cell, line });
    }
  }
  return candidates;
}

function getAnnotationAnchorFromGutterTarget(target: Element): AnnotationAnchor | null {
  const gutter = target.closest(".line-number");
  if (!(gutter instanceof HTMLElement)) {
    return null;
  }
  const file = gutter.getAttribute("data-annotation-file");
  const line = parseAnnotationGutterLine(gutter.getAttribute("data-annotation-line"));
  const side = parseAnnotationGutterSide(gutter.getAttribute("data-annotation-side"));
  if (file == null || line == null || side == null) {
    return null;
  }
  return { file, lineStart: line, lineEnd: line, side };
}

function parseAnnotationGutterLine(value: string | null): number | null {
  if (value == null) {
    return null;
  }
  const line = Number.parseInt(value, 10);
  return Number.isInteger(line) && line > 0 ? line : null;
}

function parseAnnotationGutterSide(value: string | null): AnnotationSide | null {
  return value === "old" || value === "new" ? value : null;
}

function getDiffBodyStyle(leftWidth: number): DiffBodyStyle {
  return { "--split-width": `${leftWidth}%` };
}

function DiffView({
  annotationAuthor,
  annotationEditor,
  annotationsByAnchor,
  comparison,
  diffPreview,
  leftWidth,
  mode,
  onAddAnnotation,
  onCancelAnnotation,
  onDeleteAnnotation,
  onEditAnnotation,
  onExpandContext,
  onResize,
  onSelectAnnotation,
  onSaveAnnotation,
  onToggleAnnotationResolved,
  selectedAnnotationId,
}: {
  annotationAuthor: AnnotationAuthor;
  annotationEditor: AnnotationEditorState | null;
  annotationsByAnchor: ReadonlyMap<string, readonly Annotation[]>;
  comparison: DiffComparison;
  diffPreview: DiffPreview;
  leftWidth: number;
  mode: ViewMode;
  onAddAnnotation(anchor: AnnotationAnchor, mode: AnnotationSelectionMode): void;
  onCancelAnnotation(): void;
  onDeleteAnnotation(id: string): void;
  onEditAnnotation(annotation: Annotation): void;
  onExpandContext(anchorElement: HTMLElement): void;
  onResize(width: number): void;
  onSelectAnnotation(annotation: Annotation): void;
  onSaveAnnotation(kind: AnnotationKind, body: string): void;
  onToggleAnnotationResolved(annotation: Annotation): void;
  selectedAnnotationId: string | null;
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
          annotationAuthor={annotationAuthor}
          annotationEditor={annotationEditor}
          annotationsByAnchor={annotationsByAnchor}
          filePath={diff.path}
          hunks={diff.hunks}
          leftWidth={leftWidth}
          mode={mode}
          onAddAnnotation={onAddAnnotation}
          onCancelAnnotation={onCancelAnnotation}
          onDeleteAnnotation={onDeleteAnnotation}
          onEditAnnotation={onEditAnnotation}
          onExpandContext={onExpandContext}
          onResize={onResize}
          onSelectAnnotation={onSelectAnnotation}
          onSaveAnnotation={onSaveAnnotation}
          onToggleAnnotationResolved={onToggleAnnotationResolved}
          selectedAnnotationId={selectedAnnotationId}
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
  annotationAuthor,
  annotationEditor,
  annotationsByAnchor,
  filePath,
  hunk,
  leftWidth,
  mode,
  onAddAnnotation,
  onCancelAnnotation,
  onDeleteAnnotation,
  onEditAnnotation,
  onResize,
  onSelectAnnotation,
  onSaveAnnotation,
  onToggleAnnotationResolved,
  selectedAnnotationId,
}: {
  annotationAuthor: AnnotationAuthor;
  annotationEditor: AnnotationEditorState | null;
  annotationsByAnchor: ReadonlyMap<string, readonly Annotation[]>;
  filePath: string;
  hunk: DiffHunk;
  leftWidth: number;
  mode: ViewMode;
  onAddAnnotation(anchor: AnnotationAnchor, mode: AnnotationSelectionMode): void;
  onCancelAnnotation(): void;
  onDeleteAnnotation(id: string): void;
  onEditAnnotation(annotation: Annotation): void;
  onResize(width: number): void;
  onSelectAnnotation(annotation: Annotation): void;
  onSaveAnnotation(kind: AnnotationKind, body: string): void;
  onToggleAnnotationResolved(annotation: Annotation): void;
  selectedAnnotationId: string | null;
}) {
  const annotationActions: AnnotationActions = {
    onDelete: onDeleteAnnotation,
    onEdit: onEditAnnotation,
    onSelect: onSelectAnnotation,
    onToggleResolved: onToggleAnnotationResolved,
  };
  if (mode === "stacked") {
    return (
      <section className="hunk">
        {hunk.rows.flatMap((row) =>
          renderStackedRow({
            annotationAuthor,
            annotationEditor,
            annotationsByAnchor,
            annotationActions,
            filePath,
            onAddAnnotation,
            onCancelAnnotation,
            row,
            onSaveAnnotation,
            selectedAnnotationId,
          }),
        )}
      </section>
    );
  }

  return (
    <section className="hunk split-hunk">
      {hunk.rows.map((row) => (
        <SplitRow
          annotationEditor={annotationEditor}
          annotationAuthor={annotationAuthor}
          annotationsByAnchor={annotationsByAnchor}
          annotationActions={annotationActions}
          filePath={filePath}
          key={lineKey(row)}
          onAddAnnotation={onAddAnnotation}
          onCancelAnnotation={onCancelAnnotation}
          row={row}
          onSaveAnnotation={onSaveAnnotation}
          selectedAnnotationId={selectedAnnotationId}
        />
      ))}
      <SplitResizeHandle max={72} min={28} onResize={onResize} value={leftWidth} />
    </section>
  );
});

function DiffHunkList({
  annotationAuthor,
  annotationEditor,
  annotationsByAnchor,
  filePath,
  hunks,
  leftWidth,
  mode,
  onAddAnnotation,
  onCancelAnnotation,
  onDeleteAnnotation,
  onEditAnnotation,
  onExpandContext,
  onResize,
  onSelectAnnotation,
  onSaveAnnotation,
  onToggleAnnotationResolved,
  selectedAnnotationId,
}: {
  annotationAuthor: AnnotationAuthor;
  annotationEditor: AnnotationEditorState | null;
  annotationsByAnchor: ReadonlyMap<string, readonly Annotation[]>;
  filePath: string;
  hunks: readonly DiffHunk[];
  leftWidth: number;
  mode: ViewMode;
  onAddAnnotation(anchor: AnnotationAnchor, mode: AnnotationSelectionMode): void;
  onCancelAnnotation(): void;
  onDeleteAnnotation(id: string): void;
  onEditAnnotation(annotation: Annotation): void;
  onExpandContext(anchorElement: HTMLElement): void;
  onResize(width: number): void;
  onSelectAnnotation(annotation: Annotation): void;
  onSaveAnnotation(kind: AnnotationKind, body: string): void;
  onToggleAnnotationResolved(annotation: Annotation): void;
  selectedAnnotationId: string | null;
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
        annotationAuthor={annotationAuthor}
        annotationEditor={annotationEditor}
        annotationsByAnchor={annotationsByAnchor}
        filePath={filePath}
        key={`hunk-${getHunkChangeKey(hunk)}`}
        hunk={hunk}
        leftWidth={leftWidth}
        mode={mode}
        onAddAnnotation={onAddAnnotation}
        onCancelAnnotation={onCancelAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        onEditAnnotation={onEditAnnotation}
        onResize={onResize}
        onSelectAnnotation={onSelectAnnotation}
        onSaveAnnotation={onSaveAnnotation}
        onToggleAnnotationResolved={onToggleAnnotationResolved}
        selectedAnnotationId={selectedAnnotationId}
      />,
    );
    previous = hunk;
  });

  return nodes;
}

function getHunkChangeKey(hunk: DiffHunk): string {
  const changedRow = hunk.rows.find((row) => row.kind !== "context");
  return changedRow == null ? hunk.header : lineKey(changedRow);
}

function HunkLineInfoSeparator({
  lineInfo,
  onExpandContext,
}: {
  lineInfo: HunkLineInfo;
  onExpandContext(anchorElement: HTMLElement): void;
}) {
  return (
    <section className="hunk hunk-line-info-separator">
      <button
        className="hunk-line-info"
        onClick={(event) => onExpandContext(event.currentTarget)}
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

function SplitRow({
  annotationAuthor,
  annotationEditor,
  annotationsByAnchor,
  annotationActions,
  filePath,
  onAddAnnotation,
  onCancelAnnotation,
  row,
  onSaveAnnotation,
  selectedAnnotationId,
}: {
  annotationAuthor: AnnotationAuthor;
  annotationEditor: AnnotationEditorState | null;
  annotationsByAnchor: ReadonlyMap<string, readonly Annotation[]>;
  annotationActions: AnnotationActions;
  filePath: string;
  onAddAnnotation(anchor: AnnotationAnchor, mode: AnnotationSelectionMode): void;
  onCancelAnnotation(): void;
  row: SplitDiffRow;
  onSaveAnnotation(kind: AnnotationKind, body: string): void;
  selectedAnnotationId: string | null;
}) {
  if (row.kind === "context") {
    return (
      <div className="split-row">
        <CodeCell
          annotationEditor={annotationEditor}
          annotationAuthor={annotationAuthor}
          annotationsByAnchor={annotationsByAnchor}
          annotationActions={annotationActions}
          annotationSide="old"
          filePath={filePath}
          side="old"
          tokenSide="old"
          line={row.oldLine}
          content={row.text}
          tone="context"
          onAddAnnotation={onAddAnnotation}
          onCancelAnnotation={onCancelAnnotation}
          onSaveAnnotation={onSaveAnnotation}
          selectedAnnotationId={selectedAnnotationId}
        />
        <CodeCell
          annotationEditor={annotationEditor}
          annotationAuthor={annotationAuthor}
          annotationsByAnchor={annotationsByAnchor}
          annotationActions={annotationActions}
          annotationSide="new"
          filePath={filePath}
          side="new"
          tokenSide="new"
          line={row.newLine}
          content={row.text}
          tone="context"
          onAddAnnotation={onAddAnnotation}
          onCancelAnnotation={onCancelAnnotation}
          onSaveAnnotation={onSaveAnnotation}
          selectedAnnotationId={selectedAnnotationId}
        />
      </div>
    );
  }
  if (row.kind === "delete") {
    return (
      <div className="split-row">
        <CodeCell
          annotationEditor={annotationEditor}
          annotationAuthor={annotationAuthor}
          annotationsByAnchor={annotationsByAnchor}
          annotationActions={annotationActions}
          annotationSide="old"
          filePath={filePath}
          side="old"
          tokenSide="old"
          line={row.oldLine}
          content={row.text}
          tone="delete"
          onAddAnnotation={onAddAnnotation}
          onCancelAnnotation={onCancelAnnotation}
          onSaveAnnotation={onSaveAnnotation}
          selectedAnnotationId={selectedAnnotationId}
        />
        <CodeCell
          annotationEditor={annotationEditor}
          annotationAuthor={annotationAuthor}
          annotationsByAnchor={annotationsByAnchor}
          annotationActions={annotationActions}
          filePath={filePath}
          side="new"
          line={null}
          content=""
          tone="empty"
          onAddAnnotation={onAddAnnotation}
          onCancelAnnotation={onCancelAnnotation}
          onSaveAnnotation={onSaveAnnotation}
          selectedAnnotationId={selectedAnnotationId}
        />
      </div>
    );
  }
  if (row.kind === "add") {
    return (
      <div className="split-row">
        <CodeCell
          annotationEditor={annotationEditor}
          annotationAuthor={annotationAuthor}
          annotationsByAnchor={annotationsByAnchor}
          annotationActions={annotationActions}
          filePath={filePath}
          side="old"
          line={null}
          content=""
          tone="empty"
          onAddAnnotation={onAddAnnotation}
          onCancelAnnotation={onCancelAnnotation}
          onSaveAnnotation={onSaveAnnotation}
          selectedAnnotationId={selectedAnnotationId}
        />
        <CodeCell
          annotationEditor={annotationEditor}
          annotationAuthor={annotationAuthor}
          annotationsByAnchor={annotationsByAnchor}
          annotationActions={annotationActions}
          annotationSide="new"
          filePath={filePath}
          side="new"
          tokenSide="new"
          line={row.newLine}
          content={row.text}
          tone="add"
          onAddAnnotation={onAddAnnotation}
          onCancelAnnotation={onCancelAnnotation}
          onSaveAnnotation={onSaveAnnotation}
          selectedAnnotationId={selectedAnnotationId}
        />
      </div>
    );
  }
  return (
    <div className="split-row">
      <CodeCell
        annotationEditor={annotationEditor}
        annotationAuthor={annotationAuthor}
        annotationsByAnchor={annotationsByAnchor}
        annotationActions={annotationActions}
        annotationSide="old"
        filePath={filePath}
        side="old"
        tokenSide="old"
        line={row.oldLine}
        content={row.oldText}
        tone="delete"
        wordFragments={getInlineFragments(row.oldText, row.newText, "old")}
        onAddAnnotation={onAddAnnotation}
        onCancelAnnotation={onCancelAnnotation}
        onSaveAnnotation={onSaveAnnotation}
        selectedAnnotationId={selectedAnnotationId}
      />
      <CodeCell
        annotationEditor={annotationEditor}
        annotationAuthor={annotationAuthor}
        annotationsByAnchor={annotationsByAnchor}
        annotationActions={annotationActions}
        annotationSide="new"
        filePath={filePath}
        side="new"
        tokenSide="new"
        line={row.newLine}
        content={row.newText}
        tone="add"
        wordFragments={getInlineFragments(row.oldText, row.newText, "new")}
        onAddAnnotation={onAddAnnotation}
        onCancelAnnotation={onCancelAnnotation}
        onSaveAnnotation={onSaveAnnotation}
        selectedAnnotationId={selectedAnnotationId}
      />
    </div>
  );
}

function renderStackedRow({
  annotationAuthor,
  annotationEditor,
  annotationsByAnchor,
  annotationActions,
  filePath,
  onAddAnnotation,
  onCancelAnnotation,
  onSaveAnnotation,
  row,
  selectedAnnotationId,
}: {
  annotationAuthor: AnnotationAuthor;
  annotationEditor: AnnotationEditorState | null;
  annotationsByAnchor: ReadonlyMap<string, readonly Annotation[]>;
  annotationActions: AnnotationActions;
  filePath: string;
  onAddAnnotation(anchor: AnnotationAnchor, mode: AnnotationSelectionMode): void;
  onCancelAnnotation(): void;
  onSaveAnnotation(kind: AnnotationKind, body: string): void;
  row: SplitDiffRow;
  selectedAnnotationId: string | null;
}) {
  if (row.kind === "context") {
    return [
      <CodeCell
        annotationEditor={annotationEditor}
        annotationAuthor={annotationAuthor}
        annotationsByAnchor={annotationsByAnchor}
        annotationActions={annotationActions}
        annotationSide="new"
        filePath={filePath}
        key={lineKey(row)}
        side="both"
        tokenSide="new"
        line={row.newLine}
        content={row.text}
        tone="context"
        onAddAnnotation={onAddAnnotation}
        onCancelAnnotation={onCancelAnnotation}
        onSaveAnnotation={onSaveAnnotation}
        selectedAnnotationId={selectedAnnotationId}
      />,
    ];
  }
  if (row.kind === "delete") {
    return [
      <CodeCell
        annotationEditor={annotationEditor}
        annotationAuthor={annotationAuthor}
        annotationsByAnchor={annotationsByAnchor}
        annotationActions={annotationActions}
        annotationSide="old"
        filePath={filePath}
        key={lineKey(row)}
        side="both"
        tokenSide="old"
        line={row.oldLine}
        content={row.text}
        prefix="- "
        tone="delete"
        onAddAnnotation={onAddAnnotation}
        onCancelAnnotation={onCancelAnnotation}
        onSaveAnnotation={onSaveAnnotation}
        selectedAnnotationId={selectedAnnotationId}
      />,
    ];
  }
  if (row.kind === "add") {
    return [
      <CodeCell
        annotationEditor={annotationEditor}
        annotationAuthor={annotationAuthor}
        annotationsByAnchor={annotationsByAnchor}
        annotationActions={annotationActions}
        annotationSide="new"
        filePath={filePath}
        key={lineKey(row)}
        side="both"
        tokenSide="new"
        line={row.newLine}
        content={row.text}
        prefix="+ "
        tone="add"
        onAddAnnotation={onAddAnnotation}
        onCancelAnnotation={onCancelAnnotation}
        onSaveAnnotation={onSaveAnnotation}
        selectedAnnotationId={selectedAnnotationId}
      />,
    ];
  }
  return [
    <CodeCell
      annotationEditor={annotationEditor}
      annotationAuthor={annotationAuthor}
      annotationsByAnchor={annotationsByAnchor}
      annotationActions={annotationActions}
      annotationSide="old"
      filePath={filePath}
      key={`${lineKey(row)}-old`}
      side="both"
      tokenSide="old"
      line={row.oldLine}
      content={row.oldText}
      prefix="- "
      tone="delete"
      wordFragments={getInlineFragments(row.oldText, row.newText, "old")}
      onAddAnnotation={onAddAnnotation}
      onCancelAnnotation={onCancelAnnotation}
      onSaveAnnotation={onSaveAnnotation}
      selectedAnnotationId={selectedAnnotationId}
    />,
    <CodeCell
      annotationEditor={annotationEditor}
      annotationAuthor={annotationAuthor}
      annotationsByAnchor={annotationsByAnchor}
      annotationActions={annotationActions}
      annotationSide="new"
      filePath={filePath}
      key={`${lineKey(row)}-new`}
      side="both"
      tokenSide="new"
      line={row.newLine}
      content={row.newText}
      prefix="+ "
      tone="add"
      wordFragments={getInlineFragments(row.oldText, row.newText, "new")}
      onAddAnnotation={onAddAnnotation}
      onCancelAnnotation={onCancelAnnotation}
      onSaveAnnotation={onSaveAnnotation}
      selectedAnnotationId={selectedAnnotationId}
    />,
  ];
}

type RenderSegment = {
  text: string;
  color?: string;
  highlighted: boolean;
};

function CodeCell({
  annotationAuthor,
  annotationEditor,
  annotationsByAnchor,
  annotationActions,
  annotationSide,
  content,
  filePath,
  line,
  onAddAnnotation,
  onCancelAnnotation,
  onSaveAnnotation,
  prefix,
  selectedAnnotationId,
  side,
  tokenSide,
  tone,
  wordFragments,
}: {
  annotationAuthor: AnnotationAuthor;
  annotationEditor: AnnotationEditorState | null;
  annotationsByAnchor: ReadonlyMap<string, readonly Annotation[]>;
  annotationActions: AnnotationActions;
  annotationSide?: AnnotationSide;
  content: string;
  filePath: string;
  line: number | null;
  onAddAnnotation(anchor: AnnotationAnchor, mode: AnnotationSelectionMode): void;
  onCancelAnnotation(): void;
  onSaveAnnotation(kind: AnnotationKind, body: string): void;
  prefix?: string;
  selectedAnnotationId: string | null;
  side: "old" | "new" | "both";
  tokenSide?: "old" | "new";
  tone: "add" | "context" | "delete" | "empty";
  wordFragments?: readonly RenderSegment[];
}) {
  const highlight = useContext(HighlightContext);
  const annotationDrag = useContext(AnnotationDragContext);
  const tokens = tokenSide != null && line != null ? highlight.getTokens(tokenSide, line) : null;
  const base: readonly RenderSegment[] = wordFragments ?? [{ text: content, highlighted: false }];
  const segments = tokens != null ? mergeSyntax(content, tokens, base) : base;
  const rendered = prefix != null ? [{ text: prefix, highlighted: false }, ...segments] : segments;
  const anchor =
    annotationSide == null || line == null
      ? null
      : { file: filePath, lineStart: line, lineEnd: line, side: annotationSide };
  const annotations =
    anchor == null
      ? []
      : (annotationsByAnchor.get(
          getAnnotationAnchorKey(anchor.file, anchor.lineStart, anchor.side),
        ) ?? []);
  const visibleAnnotations =
    annotationEditor?.type === "edit"
      ? annotations.filter((annotation) => annotation.id !== annotationEditor.annotation.id)
      : annotations;
  const threadAnnotations =
    line == null ? [] : visibleAnnotations.filter((annotation) => annotation.lineEnd === line);
  const editorVisible =
    anchor != null &&
    line != null &&
    annotationEditor != null &&
    annotationEditorMatchesAnchor(annotationEditor, anchor) &&
    getAnnotationEditorAnchor(annotationEditor).lineEnd === line;
  const selected =
    editorVisible ||
    (anchor != null &&
      line != null &&
      (annotationEditorMatchesAnchorNullable(annotationEditor, anchor) ||
        visibleAnnotations.some(
          (annotation) =>
            annotation.id === selectedAnnotationId &&
            isLineInAnnotationRange(annotation, anchor.file, line, anchor.side),
        )));

  function startLineAnnotation(event: AnnotationClickEvent) {
    if (anchor != null) {
      onAddAnnotation(anchor, event.shiftKey ? "extend" : "replace");
    }
  }

  function startLineAnnotationDrag(event: PointerEvent<HTMLSpanElement>) {
    if (anchor == null || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const pointerId = event.pointerId;
    if (annotationDrag == null) {
      onAddAnnotation(anchor, event.shiftKey ? "extend" : "replace");
      return;
    }

    const dragController = annotationDrag;
    dragController.start(anchor, pointerId, event.shiftKey ? "extend" : "replace");

    function cleanup() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    }

    function onPointerMove(pointerEvent: globalThis.PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }
      dragController.move(pointerEvent.clientX, pointerEvent.clientY, pointerId);
    }

    function onPointerUp(pointerEvent: globalThis.PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }
      dragController.end(pointerId);
      cleanup();
    }

    function onPointerCancel(pointerEvent: globalThis.PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }
      dragController.end(pointerId);
      cleanup();
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  }

  function extendLineAnnotationDrag() {
    if (anchor != null) {
      annotationDrag?.enter(anchor);
    }
  }

  return (
    <div className={getCodeCellClassName(side, tone, selected)}>
      <span
        className={annotations.length > 0 ? "line-number annotated" : "line-number"}
        data-annotation-file={anchor?.file}
        data-annotation-line={anchor?.lineStart}
        data-annotation-side={anchor?.side}
        onPointerDown={startLineAnnotationDrag}
        onPointerEnter={extendLineAnnotationDrag}
      >
        <span className="line-number-text">{line ?? ""}</span>
        {anchor != null ? (
          <button
            aria-label={`Annotate line ${anchor.lineStart}`}
            className="line-annotate-button"
            onClick={(event) => {
              event.stopPropagation();
              onAddAnnotation(anchor, event.shiftKey ? "extend" : "replace");
            }}
            onPointerDown={(event) => event.stopPropagation()}
            title="Annotate line"
          >
            <Plus size={10} />
          </button>
        ) : null}
        {annotations.length > 0 ? (
          <span className="line-annotation-count">
            {threadAnnotations.length || annotations.length}
          </span>
        ) : null}
      </span>
      <div className="code-content">
        <code onClick={startLineAnnotation}>
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
        {threadAnnotations.map((annotation) => (
          <InlineAnnotationCard
            annotation={annotation}
            key={annotation.id}
            selected={annotation.id === selectedAnnotationId}
            onDelete={annotationActions.onDelete}
            onEdit={annotationActions.onEdit}
            onSelect={annotationActions.onSelect}
            onToggleResolved={annotationActions.onToggleResolved}
          />
        ))}
        {editorVisible ? (
          <InlineAnnotationEditor
            author={annotationAuthor}
            state={annotationEditor}
            onCancel={onCancelAnnotation}
            onSave={onSaveAnnotation}
          />
        ) : null}
      </div>
    </div>
  );
}

function annotationEditorMatchesAnchor(
  editor: AnnotationEditorState,
  anchor: AnnotationAnchor,
): boolean {
  const editorAnchor = getAnnotationEditorAnchor(editor);
  return (
    editorAnchor.file === anchor.file &&
    editorAnchor.side === anchor.side &&
    anchor.lineStart >= editorAnchor.lineStart &&
    anchor.lineStart <= editorAnchor.lineEnd
  );
}

function annotationEditorMatchesAnchorNullable(
  editor: AnnotationEditorState | null,
  anchor: AnnotationAnchor,
): boolean {
  return editor == null ? false : annotationEditorMatchesAnchor(editor, anchor);
}

function getAnnotationEditorAnchor(editor: AnnotationEditorState): AnnotationAnchor {
  return editor.type === "edit" ? editor.annotation : editor.anchor;
}

function getCodeCellClassName(
  side: "old" | "new" | "both",
  tone: "add" | "context" | "delete" | "empty",
  selected: boolean,
): string {
  return selected ? `code-cell ${side} ${tone} selected` : `code-cell ${side} ${tone}`;
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

function headerHotkeyToMenu(action: "openRecent" | "openWorktree" | "openBranch"): HeaderMenu {
  switch (action) {
    case "openRecent":
      return "project";
    case "openWorktree":
      return "worktree";
    case "openBranch":
      return "branch";
  }
}
