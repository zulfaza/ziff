import {
  Check,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Filter,
  Folder,
  FolderOpen,
  GitBranch,
  GitFork,
  Monitor,
  Plus,
  Search,
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
  groupFiles,
  lineKey,
  mergeSyntax,
} from "./diffModel";
import { type HighlightIndex, useDiffHighlight } from "./highlighter";
import type { DiffPreview, FileTreeNode, HeaderMenu, RecentProject } from "./types";
import type {
  BranchEntry,
  DiffHunk,
  GitFileEntry,
  RepoSnapshot,
  SplitDiffRow,
  ViewMode,
  WorktreeEntry,
} from "../shared";

type DiffBodyStyle = CSSProperties & { "--split-width": string };

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
  label,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  icon?: ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <div className="header-menu-wrap">
      <button className={active ? "header-selector active" : "header-selector"} onClick={onClick}>
        {icon}
        <span>{label}</span>
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

export function FileTree({
  files,
  onToggleReadMany,
  readPaths,
  selectedPath,
  onSelect,
  onToggleRead,
}: {
  files: readonly GitFileEntry[];
  onToggleReadMany(paths: readonly string[], read: boolean): void;
  readPaths: ReadonlySet<string>;
  selectedPath: string | null;
  onSelect(path: string): void;
  onToggleRead(path: string): void;
}) {
  const grouped = useMemo(() => groupFiles(files), [files]);
  return (
    <section className="file-list">
      <FileGroup
        label="Tracked"
        nodes={grouped.tracked}
        readPaths={readPaths}
        selectedPath={selectedPath}
        onSelect={onSelect}
        onToggleRead={onToggleRead}
        onToggleReadMany={onToggleReadMany}
      />
      <FileGroup
        label="Untracked"
        nodes={grouped.untracked}
        readPaths={readPaths}
        selectedPath={selectedPath}
        onSelect={onSelect}
        onToggleRead={onToggleRead}
        onToggleReadMany={onToggleReadMany}
      />
    </section>
  );
}

function FileGroup({
  label,
  nodes,
  onToggleReadMany,
  readPaths,
  selectedPath,
  onSelect,
  onToggleRead,
}: {
  label: string;
  nodes: readonly FileTreeNode[];
  onToggleReadMany(paths: readonly string[], read: boolean): void;
  readPaths: ReadonlySet<string>;
  selectedPath: string | null;
  onSelect(path: string): void;
  onToggleRead(path: string): void;
}) {
  if (nodes.length === 0) {
    return null;
  }
  return (
    <section className="file-group">
      <div className="group-title">{label}</div>
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          readPaths={readPaths}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onToggleRead={onToggleRead}
          onToggleReadMany={onToggleReadMany}
        />
      ))}
    </section>
  );
}

function TreeNode({
  node,
  onToggleReadMany,
  readPaths,
  selectedPath,
  onSelect,
  onToggleRead,
}: {
  node: FileTreeNode;
  onToggleReadMany(paths: readonly string[], read: boolean): void;
  readPaths: ReadonlySet<string>;
  selectedPath: string | null;
  onSelect(path: string): void;
  onToggleRead(path: string): void;
}) {
  const [open, setOpen] = useState(true);
  if (node.kind === "folder") {
    const childPaths = collectFilePaths(node);
    const readCount = childPaths.filter((path) => readPaths.has(path)).length;
    const isChecked = childPaths.length > 0 && readCount === childPaths.length;
    const isMixed = readCount > 0 && readCount < childPaths.length;
    return (
      <div className="tree-folder">
        <div className="tree-row folder-row" style={{ paddingLeft: 18 }}>
          <button className="tree-folder-button" onClick={() => setOpen(!open)}>
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
    <div
      className={node.path === selectedPath ? "tree-row file-row selected" : "tree-row file-row"}
      style={{ paddingLeft: 12 }}
    >
      <button className="tree-file-button" onClick={() => onSelect(node.path)} title={node.path}>
        <span className={`file-change-icon ${getPrimaryArea(node.file.areas)}`} />
        <span>{node.name}</span>
      </button>
      <span className="tree-stats">
        <span className="positive">+{node.file.added}</span>
        <span className="negative">-{node.file.deleted}</span>
      </span>
      <input
        aria-label={`Mark ${node.path} read`}
        checked={readPaths.has(node.path)}
        className="read-check"
        onChange={() => onToggleRead(node.path)}
        type="checkbox"
      />
    </div>
  );
}

export const DEFAULT_SPLIT_WIDTH = 50;

export function DiffPreviewList({
  collapsed,
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
  collapsed: boolean;
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
        const isCollapsed = collapsed || collapsedPaths.has(preview.file.path);
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
    return <section className="preview-message">Loading diff</section>;
  }
  if (diffPreview.type === "error") {
    return <section className="preview-message">{diffPreview.message}</section>;
  }
  const diff = diffPreview.diff;
  if (diff.isBinary) {
    return <section className="preview-message">Binary file</section>;
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
      <div className="hunk-header split-header">{hunk.header}</div>
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
