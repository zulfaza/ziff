import {
  Check,
  ChevronDown,
  ChevronRight,
  Columns2,
  FileCode2,
  Filter,
  Folder,
  FolderOpen,
  GitBranch,
  GitFork,
  Monitor,
  Plus,
  RefreshCw,
  Rows3,
  Search,
} from "lucide-react";
import {
  type Dispatch,
  type PointerEvent,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  BranchEntry,
  DiffHunk,
  FileDiff,
  GitFileEntry,
  RepoSnapshot,
  SplitDiffRow,
  ViewMode,
  WorktreeEntry,
} from "./shared";

type FileTreeNode =
  | {
      kind: "folder";
      name: string;
      path: string;
      children: FileTreeNode[];
      added: number;
      deleted: number;
    }
  | {
      kind: "file";
      name: string;
      path: string;
      file: GitFileEntry;
    };

type LoadState =
  | { type: "empty" }
  | { type: "loading" }
  | { type: "ready"; snapshot: RepoSnapshot }
  | { type: "error"; message: string };

type DiffPreview =
  | { type: "loading"; file: GitFileEntry }
  | { type: "ready"; file: GitFileEntry; diff: FileDiff }
  | { type: "error"; file: GitFileEntry; message: string };

type HeaderMenu = "project" | "worktree" | "branch";

interface RecentProject {
  name: string;
  path: string;
}

const formatter = new Intl.NumberFormat("en-US");
const minSplitWidth = 1120;
const recentProjectsKey = "ziff.recentProjects";

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ type: "loading" });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diffPreviews, setDiffPreviews] = useState<readonly DiffPreview[]>([]);
  const [readPaths, setReadPaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [openHeaderMenu, setOpenHeaderMenu] = useState<HeaderMenu | null>(null);
  const [recentProjects, setRecentProjects] = useState<
    readonly RecentProject[]
  >(() => readRecentProjects());
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [diffPanelWidth, setDiffPanelWidth] = useState(minSplitWidth);
  const [leftWidth, setLeftWidth] = useState(50);
  const diffPanelRef = useRef<HTMLElement | null>(null);
  const snapshot = loadState.type === "ready" ? loadState.snapshot : null;
  const selectedFile =
    snapshot?.files.find((file) => file.path === selectedPath) ?? null;
  const totals = useMemo(() => getTotals(snapshot?.files ?? []), [snapshot]);
  const effectiveViewMode: ViewMode =
    diffPanelWidth < minSplitWidth ? "stacked" : viewMode;

  useEffect(() => {
    void window.ziff.getSnapshot().then((snapshot) => {
      if (snapshot == null) {
        setLoadState({ type: "empty" });
      } else {
        setLoadState({ type: "ready", snapshot });
        rememberProject(
          snapshot.info.projectName,
          snapshot.info.path,
          setRecentProjects,
        );
        setSelectedPath(snapshot.files[0]?.path ?? null);
      }
    });
  }, []);

  useEffect(() => {
    function closeMenu(event: MouseEvent) {
      if (
        event.target instanceof Element &&
        event.target.closest(".header-menu-wrap") != null
      ) {
        return;
      }
      setOpenHeaderMenu(null);
    }

    window.addEventListener("mousedown", closeMenu);
    return () => window.removeEventListener("mousedown", closeMenu);
  }, []);

  useEffect(() => {
    if (snapshot == null) {
      setDiffPreviews([]);
      return;
    }

    let active = true;
    const files = snapshot.files;
    setDiffPreviews(files.map((file) => ({ type: "loading", file })));
    void Promise.all(
      files.map(async (file): Promise<DiffPreview> => {
        try {
          return {
            type: "ready",
            file,
            diff: await window.ziff.getDiff(file.path),
          };
        } catch (error) {
          return { type: "error", file, message: getErrorMessage(error) };
        }
      }),
    ).then((nextPreviews) => {
      if (active) {
        setDiffPreviews(nextPreviews);
      }
    });

    return () => {
      active = false;
    };
  }, [snapshot]);

  useEffect(() => {
    const panel = diffPanelRef.current;
    if (panel == null) {
      return;
    }

    setDiffPanelWidth(panel.getBoundingClientRect().width);
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry != null) {
        setDiffPanelWidth(entry.contentRect.width);
      }
    });
    resizeObserver.observe(panel);
    return () => resizeObserver.disconnect();
  }, []);

  function toggleRead(path: string) {
    setReadPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function setManyRead(paths: readonly string[], read: boolean) {
    setReadPaths((current) => {
      const next = new Set(current);
      for (const path of paths) {
        if (read) {
          next.add(path);
        } else {
          next.delete(path);
        }
      }
      return next;
    });
  }

  function togglePreview(path: string) {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  async function chooseRepo() {
    setLoadState({ type: "loading" });
    try {
      const next = await window.ziff.chooseRepo();
      if (next == null) {
        setLoadState({ type: "empty" });
        return;
      }
      setLoadState({ type: "ready", snapshot: next });
      rememberProject(next.info.projectName, next.info.path, setRecentProjects);
      setSelectedPath(next.files[0]?.path ?? null);
    } catch (error) {
      setLoadState({ type: "error", message: getErrorMessage(error) });
    }
  }

  async function refresh() {
    const next = await window.ziff.refresh();
    if (next == null) {
      setLoadState({ type: "empty" });
      setSelectedPath(null);
      return;
    }
    setLoadState({ type: "ready", snapshot: next });
    rememberProject(next.info.projectName, next.info.path, setRecentProjects);
    if (
      selectedPath == null ||
      next.files.every((file) => file.path !== selectedPath)
    ) {
      setSelectedPath(next.files[0]?.path ?? null);
    }
  }

  async function replaceSnapshot(action: () => Promise<RepoSnapshot>) {
    const next = await action();
    setLoadState({ type: "ready", snapshot: next });
    rememberProject(next.info.projectName, next.info.path, setRecentProjects);
    if (
      selectedPath == null ||
      next.files.every((file) => file.path !== selectedPath)
    ) {
      setSelectedPath(next.files[0]?.path ?? null);
    }
  }

  async function switchWorktree(path: string) {
    setOpenHeaderMenu(null);
    const next = await window.ziff.switchWorktree(path);
    setLoadState({ type: "ready", snapshot: next });
    rememberProject(next.info.projectName, next.info.path, setRecentProjects);
    setSelectedPath(next.files[0]?.path ?? null);
  }

  async function switchBranch(branch: string) {
    setOpenHeaderMenu(null);
    await replaceSnapshot(() => window.ziff.switchBranch(branch));
  }

  if (loadState.type === "loading") {
    return <Splash label="Loading" />;
  }

  if (loadState.type === "empty") {
    return <Splash label="Open a local Git repo" onClick={chooseRepo} />;
  }

  if (loadState.type === "error") {
    return <Splash label={loadState.message} onClick={chooseRepo} />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="traffic" />
        <RepoHeader
          menu={openHeaderMenu}
          recentProjects={recentProjects}
          snapshot={loadState.snapshot}
          onChooseRepo={() => void chooseRepo()}
          onMenuChange={setOpenHeaderMenu}
          onSwitchBranch={(branch) => void switchBranch(branch)}
          onSwitchProject={(path) => void switchWorktree(path)}
          onSwitchWorktree={(path) => void switchWorktree(path)}
        />
        <button
          className="icon-button"
          title="Refresh"
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} />
        </button>
      </header>

      <div className="workbench">
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <section className="sidebar-tabs">
            <button className="tab active">
              Changes ({loadState.snapshot.files.length})
            </button>
            <button className="tab">History</button>
          </section>
          <section className="sidebar-actions">
            <button className="link-button" onClick={chooseRepo}>
              View Diff
            </button>
            <span className="positive">+{formatter.format(totals.added)}</span>
            <span className="negative">
              -{formatter.format(totals.deleted)}
            </span>
            <button
              className="small-button"
              onClick={() => void replaceSnapshot(window.ziff.stageAll)}
            >
              Stage All
            </button>
          </section>
          <FileTree
            files={loadState.snapshot.files}
            readPaths={readPaths}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
            onToggleRead={toggleRead}
            onToggleReadMany={setManyRead}
          />
        </aside>
        <ResizeHandle
          label="Resize changes panel"
          max={560}
          min={260}
          onResize={setSidebarWidth}
          value={sidebarWidth}
        />

        <section className="diff-panel" ref={diffPanelRef}>
          <div className="diff-toolbar">
            <button
              className="icon-button"
              title={allCollapsed ? "Expand previews" : "Collapse previews"}
              onClick={() => setAllCollapsed(!allCollapsed)}
            >
              {allCollapsed ? (
                <ChevronRight size={16} />
              ) : (
                <ChevronDown size={16} />
              )}
            </button>
            <div className="segmented" aria-label="Diff layout">
              <button
                className={effectiveViewMode === "stacked" ? "active" : ""}
                onClick={() => setViewMode("stacked")}
                title="Stacked diff"
              >
                <Rows3 size={16} />
              </button>
              <button
                className={effectiveViewMode === "split" ? "active" : ""}
                disabled={diffPanelWidth < minSplitWidth}
                onClick={() => setViewMode("split")}
                title={
                  diffPanelWidth < minSplitWidth
                    ? "Split diff needs more width"
                    : "Split diff"
                }
              >
                <Columns2 size={16} />
              </button>
            </div>
            <div className="toolbar-spacer" />
            {selectedFile != null ? (
              <>
                <button
                  className="toolbar-button"
                  onClick={() =>
                    void replaceSnapshot(() =>
                      window.ziff.stage(selectedFile.path),
                    )
                  }
                >
                  Stage
                </button>
                <button
                  className="toolbar-button"
                  onClick={() =>
                    void replaceSnapshot(() =>
                      window.ziff.unstage(selectedFile.path),
                    )
                  }
                >
                  Unstage
                </button>
              </>
            ) : null}
          </div>
          <DiffPreviewList
            previews={diffPreviews}
            collapsedPaths={collapsedPaths}
            readPaths={readPaths}
            selectedPath={selectedPath}
            collapsed={allCollapsed}
            leftWidth={leftWidth}
            mode={effectiveViewMode}
            onOpenFile={(path) => void window.ziff.openFile(path)}
            onResize={setLeftWidth}
            onSelect={setSelectedPath}
            onTogglePreview={togglePreview}
            onToggleRead={toggleRead}
          />
        </section>
      </div>
    </main>
  );
}

function RepoHeader({
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
          <BranchMenu
            branches={info.branches}
            onSwitchBranch={onSwitchBranch}
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
      <button
        className={active ? "header-selector active" : "header-selector"}
        onClick={onClick}
      >
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
      <SearchField
        onChange={setQuery}
        placeholder="Search projects..."
        value={query}
      />
      <div className="menu-section-title">Recent Projects</div>
      <div className="menu-list">
        {filteredProjects.map((project) => (
          <button
            className={
              project.path === currentPath ? "menu-row active" : "menu-row"
            }
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
        <span className="menu-primary">
          Create new worktree based on {currentBranch}
        </span>
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
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function CheckMark({ visible }: { visible: boolean }) {
  return (
    <span className="menu-check">{visible ? <Check size={15} /> : null}</span>
  );
}

function ResizeHandle({
  label,
  max,
  min,
  onResize,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onResize(value: number): void;
  value: number;
}) {
  function startResize(event: PointerEvent<HTMLDivElement>) {
    const startX = event.clientX;
    const startValue = value;

    function update(nextEvent: globalThis.PointerEvent) {
      onResize(clamp(startValue + nextEvent.clientX - startX, min, max));
    }

    function stopResize() {
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", stopResize);
    }

    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", stopResize);
  }

  return (
    <div
      aria-label={label}
      className="panel-resizer"
      onPointerDown={startResize}
      role="separator"
      tabIndex={0}
    />
  );
}

function Splash({ label, onClick }: { label: string; onClick?: () => void }) {
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

function FileTree({
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
      className={
        node.path === selectedPath
          ? "tree-row file-row selected"
          : "tree-row file-row"
      }
      style={{ paddingLeft: 20 }}
    >
      <button
        className="tree-file-button"
        onClick={() => onSelect(node.path)}
        title={node.path}
      >
        <span
          className={`file-change-icon ${getPrimaryArea(node.file.areas)}`}
        />
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

function DiffPreviewList({
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
    <section className="diff-body">
      {previews.map((preview) => {
        const isCollapsed = collapsed || collapsedPaths.has(preview.file.path);
        return (
          <section
            className={
              preview.file.path === selectedPath
                ? "file-preview selected"
                : "file-preview"
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
                onClick={() => onTogglePreview(preview.file.path)}
                title={
                  isCollapsed ? "Expand file preview" : "Collapse file preview"
                }
              >
                {isCollapsed ? (
                  <ChevronRight size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
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
              <span className="file-dir">
                {getDirectory(preview.file.path)}
              </span>
              <span className="preview-stats">
                <span className="positive">+{preview.file.added}</span>
                <span className="negative">-{preview.file.deleted}</span>
              </span>
              <button
                className="toolbar-button"
                onClick={() => onOpenFile(preview.file.path)}
              >
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
    <>
      {diff.hunks.map((hunk) => (
        <HunkView
          key={hunk.header}
          hunk={hunk}
          leftWidth={leftWidth}
          mode={mode}
          onResize={onResize}
        />
      ))}
    </>
  );
}

function HunkView({
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
      <div
        className="hunk-header split-header"
        style={{ gridTemplateColumns: `${leftWidth}% 1fr` }}
      >
        {hunk.header}
      </div>
      {hunk.rows.map((row, index) => (
        <SplitRow
          key={`${index}-${lineKey(row)}`}
          leftWidth={leftWidth}
          row={row}
        />
      ))}
      <SplitResizeHandle
        max={72}
        min={28}
        onResize={onResize}
        style={{ left: `calc(${leftWidth}% - 3px)` }}
        value={leftWidth}
      />
    </section>
  );
}

function SplitResizeHandle({
  max,
  min,
  onResize,
  style,
  value,
}: {
  max: number;
  min: number;
  onResize(width: number): void;
  style: { left: string };
  value: number;
}) {
  function startResize(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (bounds == null || bounds.width <= 0) {
      return;
    }
    const boundsLeft = bounds.left;
    const boundsWidth = bounds.width;

    function update(nextEvent: globalThis.PointerEvent) {
      onResize(
        clamp(((nextEvent.clientX - boundsLeft) / boundsWidth) * 100, min, max),
      );
    }

    function stopResize() {
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", stopResize);
    }

    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", stopResize);
  }

  return (
    <div
      aria-label="Resize split diff"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      className="resize-slider"
      onPointerDown={startResize}
      role="separator"
      style={style}
      tabIndex={0}
    />
  );
}

function SplitRow({
  leftWidth,
  row,
}: {
  leftWidth: number;
  row: SplitDiffRow;
}) {
  const style = { gridTemplateColumns: `${leftWidth}% 1fr` };
  if (row.kind === "context") {
    return (
      <div className="split-row" style={style}>
        <CodeCell
          side="old"
          line={row.oldLine}
          text={row.text}
          tone="context"
        />
        <CodeCell
          side="new"
          line={row.newLine}
          text={row.text}
          tone="context"
        />
      </div>
    );
  }
  if (row.kind === "delete") {
    return (
      <div className="split-row" style={style}>
        <CodeCell side="old" line={row.oldLine} text={row.text} tone="delete" />
        <CodeCell side="new" line={null} text="" tone="empty" />
      </div>
    );
  }
  if (row.kind === "add") {
    return (
      <div className="split-row" style={style}>
        <CodeCell side="old" line={null} text="" tone="empty" />
        <CodeCell side="new" line={row.newLine} text={row.text} tone="add" />
      </div>
    );
  }
  return (
    <div className="split-row" style={style}>
      <CodeCell
        side="old"
        line={row.oldLine}
        text={row.oldText}
        tone="delete"
        fragments={getInlineFragments(row.oldText, row.newText, "old")}
      />
      <CodeCell
        side="new"
        line={row.newLine}
        text={row.newText}
        tone="add"
        fragments={getInlineFragments(row.oldText, row.newText, "new")}
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
        line={row.newLine}
        text={row.text}
        tone="context"
      />,
    ];
  }
  if (row.kind === "delete") {
    return [
      <CodeCell
        key={index}
        side="both"
        line={row.oldLine}
        text={`- ${row.text}`}
        tone="delete"
      />,
    ];
  }
  if (row.kind === "add") {
    return [
      <CodeCell
        key={index}
        side="both"
        line={row.newLine}
        text={`+ ${row.text}`}
        tone="add"
      />,
    ];
  }
  return [
    <CodeCell
      key={`${index}-old`}
      side="both"
      line={row.oldLine}
      text={`- ${row.oldText}`}
      tone="delete"
      fragments={withPrefix(
        "- ",
        getInlineFragments(row.oldText, row.newText, "old"),
      )}
    />,
    <CodeCell
      key={`${index}-new`}
      side="both"
      line={row.newLine}
      text={`+ ${row.newText}`}
      tone="add"
      fragments={withPrefix(
        "+ ",
        getInlineFragments(row.oldText, row.newText, "new"),
      )}
    />,
  ];
}

type InlineFragment = {
  text: string;
  highlighted: boolean;
};

type FragmentSide = "old" | "new";

type TokenEdit =
  | { kind: "same"; oldToken: string; newToken: string }
  | { kind: "delete"; token: string }
  | { kind: "add"; token: string };

function CodeCell({
  fragments,
  line,
  side,
  text,
  tone,
}: {
  fragments?: readonly InlineFragment[];
  line: number | null;
  side: "old" | "new" | "both";
  text: string;
  tone: "add" | "context" | "delete" | "empty";
}) {
  const renderedText = fragments ?? [{ text, highlighted: false }];
  return (
    <div className={`code-cell ${side} ${tone}`}>
      <span className="line-number">{line ?? ""}</span>
      <code>
        {renderedText.map((fragment, index) => (
          <span
            className={fragment.highlighted ? "text-highlight" : undefined}
            key={`${index}-${fragment.text}`}
          >
            {fragment.text}
          </span>
        ))}
      </code>
    </div>
  );
}

function getInlineFragments(
  oldText: string,
  newText: string,
  side: FragmentSide,
): readonly InlineFragment[] {
  const edits = diffTokens(
    tokenizeForInlineDiff(oldText),
    tokenizeForInlineDiff(newText),
  );
  return edits.flatMap((edit): readonly InlineFragment[] => {
    if (edit.kind === "same") {
      return [
        {
          text: side === "old" ? edit.oldToken : edit.newToken,
          highlighted: false,
        },
      ];
    }
    if (edit.kind === "delete") {
      return side === "old" ? [{ text: edit.token, highlighted: true }] : [];
    }
    return side === "new" ? [{ text: edit.token, highlighted: true }] : [];
  });
}

function withPrefix(
  prefix: string,
  fragments: readonly InlineFragment[],
): readonly InlineFragment[] {
  return [{ text: prefix, highlighted: false }, ...fragments];
}

function tokenizeForInlineDiff(text: string): readonly string[] {
  const tokens = text.match(/\s+|[A-Za-z0-9_$@./:-]+|./gu);
  return tokens ?? [];
}

function diffTokens(
  oldTokens: readonly string[],
  newTokens: readonly string[],
): readonly TokenEdit[] {
  const distances = buildLcsDistances(oldTokens, newTokens);
  const edits: TokenEdit[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldTokens.length && newIndex < newTokens.length) {
    const oldToken = oldTokens[oldIndex];
    const newToken = newTokens[newIndex];
    if (oldToken == null || newToken == null) {
      break;
    }
    if (oldToken === newToken) {
      edits.push({ kind: "same", oldToken, newToken });
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    const deleteScore = getDistance(distances, oldIndex + 1, newIndex);
    const addScore = getDistance(distances, oldIndex, newIndex + 1);
    if (deleteScore >= addScore) {
      edits.push({ kind: "delete", token: oldToken });
      oldIndex += 1;
    } else {
      edits.push({ kind: "add", token: newToken });
      newIndex += 1;
    }
  }

  while (oldIndex < oldTokens.length) {
    const token = oldTokens[oldIndex];
    if (token != null) {
      edits.push({ kind: "delete", token });
    }
    oldIndex += 1;
  }

  while (newIndex < newTokens.length) {
    const token = newTokens[newIndex];
    if (token != null) {
      edits.push({ kind: "add", token });
    }
    newIndex += 1;
  }

  return edits;
}

function buildLcsDistances(
  oldTokens: readonly string[],
  newTokens: readonly string[],
): readonly (readonly number[])[] {
  const rows: number[][] = [];
  for (let oldIndex = 0; oldIndex <= oldTokens.length; oldIndex += 1) {
    const row: number[] = [];
    for (let newIndex = 0; newIndex <= newTokens.length; newIndex += 1) {
      row.push(0);
    }
    rows.push(row);
  }

  for (let oldIndex = oldTokens.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newTokens.length - 1; newIndex >= 0; newIndex -= 1) {
      const oldToken = oldTokens[oldIndex];
      const newToken = newTokens[newIndex];
      if (oldToken != null && newToken != null && oldToken === newToken) {
        rows[oldIndex][newIndex] =
          getDistance(rows, oldIndex + 1, newIndex + 1) + 1;
      } else {
        rows[oldIndex][newIndex] = Math.max(
          getDistance(rows, oldIndex + 1, newIndex),
          getDistance(rows, oldIndex, newIndex + 1),
        );
      }
    }
  }

  return rows;
}

function getDistance(
  rows: readonly (readonly number[])[],
  oldIndex: number,
  newIndex: number,
): number {
  return rows[oldIndex]?.[newIndex] ?? 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function groupFiles(files: readonly GitFileEntry[]) {
  const tracked = files.filter((file) => !isUntracked(file));
  const untracked = files.filter(isUntracked);
  return {
    tracked: buildTree(tracked),
    untracked: buildTree(untracked),
  };
}

function isUntracked(file: GitFileEntry): boolean {
  return file.areas.includes("untracked");
}

function collectFilePaths(node: FileTreeNode): readonly string[] {
  if (node.kind === "file") {
    return [node.path];
  }
  return node.children.flatMap(collectFilePaths);
}

function buildTree(files: readonly GitFileEntry[]): readonly FileTreeNode[] {
  const root: TreeFolder = createFolder("", "");
  for (const file of files) {
    insertFile(root, file.path.split("/"), file);
  }
  return sortTree(root.children);
}

interface TreeFolder {
  children: FileTreeNode[];
  name: string;
  path: string;
}

function createFolder(name: string, path: string): TreeFolder {
  return { name, path, children: [] };
}

function insertFile(
  folder: TreeFolder,
  parts: readonly string[],
  file: GitFileEntry,
): void {
  const [head, ...tail] = parts;
  if (head == null) {
    return;
  }
  if (tail.length === 0) {
    folder.children.push({ kind: "file", name: head, path: file.path, file });
    return;
  }

  const nextPath = folder.path.length === 0 ? head : `${folder.path}/${head}`;
  let existing = folder.children.find(
    (node) => node.kind === "folder" && node.path === nextPath,
  );
  if (existing == null || existing.kind !== "folder") {
    existing = {
      kind: "folder",
      name: head,
      path: nextPath,
      children: [],
      added: 0,
      deleted: 0,
    };
    folder.children.push(existing);
  }
  insertFile(
    { name: existing.name, path: existing.path, children: existing.children },
    tail,
    file,
  );
  existing.added += file.added;
  existing.deleted += file.deleted;
}

function sortTree(nodes: readonly FileTreeNode[]): readonly FileTreeNode[] {
  return nodes
    .map((node): FileTreeNode => {
      if (node.kind === "file") {
        return node;
      }
      return { ...node, children: [...sortTree(node.children)] };
    })
    .toSorted(compareTreeNodes);
}

function compareTreeNodes(left: FileTreeNode, right: FileTreeNode): number {
  const kindOrder = getTreeNodeKindOrder(left) - getTreeNodeKindOrder(right);
  if (kindOrder !== 0) {
    return kindOrder;
  }
  return left.name.localeCompare(right.name, undefined, {
    sensitivity: "base",
  });
}

function getTreeNodeKindOrder(node: FileTreeNode): number {
  return node.kind === "folder" ? 0 : 1;
}

function getTotals(files: readonly GitFileEntry[]) {
  return files.reduce(
    (totals, file) => ({
      added: totals.added + file.added,
      deleted: totals.deleted + file.deleted,
    }),
    { added: 0, deleted: 0 },
  );
}

function getBasename(path: string): string {
  const parts = path.split("/");
  return parts.at(-1) ?? path;
}

function getDirectory(path: string): string {
  const name = getBasename(path);
  if (name === path) {
    return "";
  }
  return path.slice(0, path.length - name.length);
}

function getPrimaryArea(areas: GitFileEntry["areas"]): string {
  return areas[0] ?? "unstaged";
}

function lineKey(row: SplitDiffRow): string {
  switch (row.kind) {
    case "context":
      return `${row.oldLine}-${row.newLine}`;
    case "delete":
      return `${row.oldLine}`;
    case "add":
      return `${row.newLine}`;
    case "modify":
      return `${row.oldLine}-${row.newLine}`;
  }
}

function toggleMenu(
  current: HeaderMenu | null,
  next: HeaderMenu,
): HeaderMenu | null {
  return current === next ? null : next;
}

function rememberProject(
  name: string,
  path: string,
  setRecentProjects: Dispatch<SetStateAction<readonly RecentProject[]>>,
): void {
  setRecentProjects((current) => {
    const next = [
      { name, path },
      ...current.filter((project) => project.path !== path),
    ].slice(0, 12);
    writeRecentProjects(next);
    return next;
  });
}

function readRecentProjects(): readonly RecentProject[] {
  try {
    const raw = localStorage.getItem(recentProjectsKey);
    if (raw == null) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((value): readonly RecentProject[] => {
      const project = parseRecentProject(value);
      return project == null ? [] : [project];
    });
  } catch {
    return [];
  }
}

function writeRecentProjects(projects: readonly RecentProject[]): void {
  try {
    localStorage.setItem(recentProjectsKey, JSON.stringify(projects));
  } catch {
    return;
  }
}

function parseRecentProject(value: unknown): RecentProject | null {
  if (
    typeof value !== "object" ||
    value == null ||
    !("name" in value) ||
    !("path" in value) ||
    typeof value.name !== "string" ||
    typeof value.path !== "string"
  ) {
    return null;
  }
  return { name: value.name, path: value.path };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}
