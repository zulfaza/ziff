import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Code2,
  FileCode2,
  Filter,
  Folder,
  FolderOpen,
  GitBranch,
  GitFork,
  Image as ImageIcon,
  Monitor,
  Plus,
  Search,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  createContext,
  memo,
  useContext,
  useEffect,
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
  DiffHunk,
  GitFileEntry,
  ImagePreview,
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

const formatter = new Intl.NumberFormat("en-US");

export function RepoHeader({
  menu,
  onChooseRepo,
  onMenuChange,
  onSwitchBranch,
  onSwitchProject,
  onSwitchWorktree,
  recentProjects,
  snapshot,
}: {
  menu: HeaderMenu | null;
  onChooseRepo(): void;
  onMenuChange(menu: HeaderMenu | null): void;
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
  onSwitchProject,
  projects,
}: {
  currentPath: string;
  onChooseRepo(): void;
  onSwitchProject(path: string): void;
  projects: readonly RecentProject[];
}) {
  const [query, setQuery] = useState("");
  const filteredProjects = projects.filter((project) =>
    project.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="header-menu project-menu">
      <SearchField onChange={setQuery} placeholder="Search projects..." value={query} />
      <div className="menu-section-title">Recent Projects</div>
      <div className="menu-list">
        {filteredProjects.map((project) => (
          <button
            className={project.path === currentPath ? "menu-row active" : "menu-row"}
            key={project.path}
            onClick={() => onSwitchProject(project.path)}
          >
            <Monitor size={17} />
            <span className="menu-primary">{project.name}</span>
          </button>
        ))}
      </div>
      <div className="menu-footer">
        <button onClick={onChooseRepo}>Open Local Folder</button>
        <button onClick={onChooseRepo}>Open Remote Folder</button>
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

export function Splash({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <main className="splash">
      <div className="brand large">ziff</div>
      <p>{label}</p>
      {onClick == null ? null : (
        <button className="primary-button" onClick={onClick}>
          Open Repo
        </button>
      )}
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

export function HistoryList({
  commits,
  loading,
}: {
  commits: readonly CommitEntry[];
  loading: boolean;
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
        <article className="commit-row" key={commit.hash}>
          <div className="commit-subject" title={commit.subject}>
            {commit.subject}
          </div>
          <div className="commit-meta">
            <UserRound size={14} />
            <span className="commit-author">{commit.author}</span>
            <span className="commit-dot">·</span>
            <span>{commit.relativeTime}</span>
            <span className="commit-dot">·</span>
            <span>{commit.shortHash}</span>
          </div>
        </article>
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

export function DiffPreviewList({
  collapsedPaths,
  leftWidth,
  mode,
  onOpenFile,
  onResize,
  onSelect,
  onTogglePreview,
  onToggleRead,
  previews,
  readPaths,
  selectedPath,
}: {
  collapsedPaths: ReadonlySet<string>;
  leftWidth: number;
  mode: ViewMode;
  onOpenFile(path: string): void;
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
              <button className="toolbar-button" onClick={() => onOpenFile(preview.file.path)}>
                Open File
              </button>
            </header>
            {isCollapsed ? null : (
              <DiffView
                diffPreview={preview}
                leftWidth={leftWidth}
                mode={mode}
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
  diffPreview,
  leftWidth,
  mode,
  onResize,
}: {
  diffPreview: DiffPreview;
  leftWidth: number;
  mode: ViewMode;
  onResize(width: number): void;
}) {
  const highlight = useDiffHighlight(diffPreview.type === "ready" ? diffPreview.diff : null);
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
  if (diff.isBinary) {
    return (
      <section className="hunk preview-hunk">
        <section className="preview-message">Binary file not shown.</section>
      </section>
    );
  }
  return (
    <HighlightContext.Provider value={highlight}>
      {diff.hunks.map((hunk) => (
        <HunkView
          key={hunk.header}
          hunk={hunk}
          leftWidth={leftWidth}
          mode={mode}
          onResize={onResize}
        />
      ))}
    </HighlightContext.Provider>
  );
}

const HighlightContext = createContext<HighlightIndex>({ getTokens: () => null });

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
        <div className="hunk-header">{hunk.header}</div>
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

function toggleMenu(current: HeaderMenu | null, next: HeaderMenu): HeaderMenu | null {
  return current === next ? null : next;
}
