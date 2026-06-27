import { ChevronDown, ChevronRight, Columns2, RefreshCw, Rows3 } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SPLIT_WIDTH,
  DiffPreviewList,
  FileTree,
  RepoHeader,
  ResizeHandle,
  Splash,
} from "./components";
import { getTotals } from "./diffModel";
import { resolveAppHotkey } from "./hotkeys";
import { readRecentProjects, rememberProject } from "./recentProjects";
import type { DiffPreview, HeaderMenu, LoadState, RecentProject } from "./types";
import type { RepoSnapshot, ViewMode } from "../shared";

const formatter = new Intl.NumberFormat("en-US");
const minSplitWidth = 1120;
const defaultSidebarWidth = 360;
type WorkbenchStyle = CSSProperties & { "--sidebar-width": string };

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ type: "loading" });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diffPreviews, setDiffPreviews] = useState<readonly DiffPreview[]>([]);
  const [readPaths, setReadPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [openHeaderMenu, setOpenHeaderMenu] = useState<HeaderMenu | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [recentProjects, setRecentProjects] = useState<readonly RecentProject[]>(() =>
    readRecentProjects(),
  );
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth);
  const [isDiffPanelNarrow, setIsDiffPanelNarrow] = useState(false);
  const [leftWidth, setLeftWidth] = useState(DEFAULT_SPLIT_WIDTH);
  const diffPanelRef = useRef<HTMLElement | null>(null);
  const snapshot = loadState.type === "ready" ? loadState.snapshot : null;
  const selectedFile = snapshot?.files.find((file) => file.path === selectedPath) ?? null;
  const totals = useMemo(() => getTotals(snapshot?.files ?? []), [snapshot]);
  const effectiveViewMode: ViewMode = isDiffPanelNarrow ? "stacked" : viewMode;

  useEffect(() => {
    void window.ziff.getSnapshot().then((snapshot) => {
      if (snapshot == null) {
        setLoadState({ type: "empty" });
      } else {
        setLoadState({ type: "ready", snapshot });
        rememberProject(snapshot.info.projectName, snapshot.info.path, setRecentProjects);
        setSelectedPath(snapshot.files[0]?.path ?? null);
      }
    });
  }, []);

  useEffect(() => {
    function closeMenu(event: MouseEvent) {
      if (event.target instanceof Element && event.target.closest(".header-menu-wrap") != null) {
        return;
      }
      setOpenHeaderMenu(null);
    }

    window.addEventListener("mousedown", closeMenu);
    return () => window.removeEventListener("mousedown", closeMenu);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && openHeaderMenu != null) {
        event.preventDefault();
        setOpenHeaderMenu(null);
        return;
      }

      const action = resolveAppHotkey(event);
      if (action == null) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      switch (action) {
        case "openRecent":
          if (loadState.type === "ready") {
            setOpenHeaderMenu("project");
          }
          return;
        case "openWorktree":
          if (loadState.type === "ready") {
            setOpenHeaderMenu("worktree");
          }
          return;
        case "openBranch":
          if (loadState.type === "ready") {
            setOpenHeaderMenu("branch");
          }
          return;
        case "toggleSidebar":
          setSidebarVisible((visible) => !visible);
          return;
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [loadState.type, openHeaderMenu]);

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

    // Store only the threshold result, not the raw width: React bails out of a
    // setState with an unchanged primitive, so dragging the sidebar (which
    // resizes this panel every frame) won't re-render the diff tree unless the
    // split/stacked boundary is actually crossed.
    setIsDiffPanelNarrow(panel.getBoundingClientRect().width < minSplitWidth);
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry != null) {
        setIsDiffPanelNarrow(entry.contentRect.width < minSplitWidth);
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
    if (selectedPath == null || next.files.every((file) => file.path !== selectedPath)) {
      setSelectedPath(next.files[0]?.path ?? null);
    }
  }

  async function replaceSnapshot(action: () => Promise<RepoSnapshot>) {
    const next = await action();
    setLoadState({ type: "ready", snapshot: next });
    rememberProject(next.info.projectName, next.info.path, setRecentProjects);
    if (selectedPath == null || next.files.every((file) => file.path !== selectedPath)) {
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
        <button className="icon-button" title="Refresh" onClick={() => void refresh()}>
          <RefreshCw size={15} />
        </button>
      </header>

      <div className="workbench" style={getWorkbenchStyle(sidebarWidth)}>
        {sidebarVisible ? (
          <>
            <aside className="sidebar">
              <section className="sidebar-tabs">
                <button className="tab active">Changes ({loadState.snapshot.files.length})</button>
                <button className="tab">History</button>
              </section>
              <section className="sidebar-actions">
                <button className="link-button" onClick={chooseRepo}>
                  View Diff
                </button>
                <span className="positive">+{formatter.format(totals.added)}</span>
                <span className="negative">-{formatter.format(totals.deleted)}</span>
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
              defaultValue={defaultSidebarWidth}
              label="Resize changes panel"
              max={560}
              min={260}
              onResize={setSidebarWidth}
              value={sidebarWidth}
            />
          </>
        ) : null}

        <section className="diff-panel" ref={diffPanelRef}>
          <div className="diff-toolbar">
            <button
              className="icon-button"
              title={allCollapsed ? "Expand previews" : "Collapse previews"}
              onClick={() => setAllCollapsed(!allCollapsed)}
            >
              {allCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
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
                disabled={isDiffPanelNarrow}
                onClick={() => setViewMode("split")}
                title={isDiffPanelNarrow ? "Split diff needs more width" : "Split diff"}
              >
                <Columns2 size={16} />
              </button>
            </div>
            <div className="toolbar-spacer" />
            {selectedFile != null ? (
              <>
                <button
                  className="toolbar-button"
                  onClick={() => void replaceSnapshot(() => window.ziff.stage(selectedFile.path))}
                >
                  Stage
                </button>
                <button
                  className="toolbar-button"
                  onClick={() => void replaceSnapshot(() => window.ziff.unstage(selectedFile.path))}
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

function getWorkbenchStyle(sidebarWidth: number): WorkbenchStyle {
  return { "--sidebar-width": `${sidebarWidth}px` };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}
