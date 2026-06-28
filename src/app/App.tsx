import { ChevronsDownUp, ChevronsUpDown, Columns2, RefreshCw, Rows3 } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SPLIT_WIDTH,
  ComparisonControls,
  DiffPreviewList,
  ChangesPanel,
  HistoryList,
  RepoHeader,
  ResizeHandle,
  Splash,
} from "./components";
import { AnnotationsPanel } from "./annotationUi";
import { getTotals } from "./diffModel";
import { resolveAppHotkey } from "./hotkeys";
import { forgetProject, readRecentProjects, rememberProject } from "./recentProjects";
import type { DiffPreview, HeaderMenu, LoadState, RecentProject, SidebarTab } from "./types";
import type {
  Annotation,
  CommitEntry,
  DiffComparison,
  RepoSnapshot,
  SidebarSettings,
  ViewMode,
} from "../shared";

const minSplitWidth = 1120;
const defaultSidebarWidth = 360;
const defaultDiffContextLines = 3;
const diffContextExpansionLines = 5;
const WORKING_TREE_COMPARISON: DiffComparison = { type: "working-tree" };
type WorkbenchStyle = CSSProperties & { "--sidebar-width": string };

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ type: "loading" });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [comparison, setComparison] = useState<DiffComparison>(WORKING_TREE_COMPARISON);
  const [diffPreviews, setDiffPreviews] = useState<readonly DiffPreview[]>([]);
  const [diffContextLines, setDiffContextLines] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const [readPaths, setReadPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [openHeaderMenu, setOpenHeaderMenu] = useState<HeaderMenu | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("changes");
  const [commits, setCommits] = useState<readonly CommitEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [recentProjects, setRecentProjects] = useState<readonly RecentProject[]>(() =>
    readRecentProjects(),
  );
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth);
  const [isDiffPanelNarrow, setIsDiffPanelNarrow] = useState(false);
  const [leftWidth, setLeftWidth] = useState(DEFAULT_SPLIT_WIDTH);
  const [sidebarSettings, setSidebarSettings] = useState<SidebarSettings>({
    fileGroupBy: "status",
    fileListView: "tree",
  });
  const [annotations, setAnnotations] = useState<readonly Annotation[]>([]);
  const [annotationsReady, setAnnotationsReady] = useState(false);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const diffPanelRef = useRef<HTMLElement | null>(null);
  const saveAnnotationsTimerRef = useRef<number | undefined>(undefined);
  const diffContextLinesRef = useRef(diffContextLines);
  diffContextLinesRef.current = diffContextLines;
  const snapshot = loadState.type === "ready" ? loadState.snapshot : null;
  const totals = useMemo(() => getTotals(snapshot?.files ?? []), [snapshot]);
  const previewPaths = useMemo(
    () => diffPreviews.map((preview) => preview.file.path),
    [diffPreviews],
  );
  const allCollapsed =
    previewPaths.length > 0 && previewPaths.every((path) => collapsedPaths.has(path));
  const effectiveViewMode: ViewMode = isDiffPanelNarrow ? "stacked" : viewMode;
  const restoreInitialProject = shouldRestoreInitialProject();

  useEffect(() => {
    void window.ziff.getSnapshot().then(async (snapshot) => {
      if (snapshot != null) {
        setLoadState({ type: "ready", snapshot });
        rememberProject(snapshot.info.projectName, snapshot.info.path, setRecentProjects);
        setSelectedPath(snapshot.files[0]?.path ?? null);
        return;
      }
      if (!restoreInitialProject) {
        setLoadState({ type: "empty" });
        return;
      }
      const lastProject = recentProjects[0];
      if (lastProject != null) {
        try {
          const next = await window.ziff.switchWorktree(lastProject.path);
          setLoadState({ type: "ready", snapshot: next });
          rememberProject(next.info.projectName, next.info.path, setRecentProjects);
          setSelectedPath(next.files[0]?.path ?? null);
          return;
        } catch {
          // Fall through to empty state if the remembered project can't be opened.
        }
      }
      setLoadState({ type: "empty" });
    });
    void window.ziff.getSettings().then(setSidebarSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            diff: await window.ziff.getDiff({
              path: file.path,
              comparison,
              contextLines: diffContextLinesRef.current.get(file.path) ?? defaultDiffContextLines,
            }),
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
  }, [snapshot, comparison]);

  useEffect(() => {
    if (snapshot == null) {
      setAnnotations([]);
      setAnnotationsReady(false);
      setSelectedAnnotationId(null);
      return;
    }

    let active = true;
    setAnnotationsReady(false);
    void window.ziff
      .getAnnotations({ repoPath: snapshot.info.path, comparison })
      .then((nextAnnotations) => {
        if (active) {
          setAnnotations(nextAnnotations);
          setSelectedAnnotationId(null);
          setAnnotationsReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, [snapshot, comparison]);

  useEffect(() => {
    if (!annotationsReady || snapshot == null) {
      return;
    }

    window.clearTimeout(saveAnnotationsTimerRef.current);
    saveAnnotationsTimerRef.current = window.setTimeout(() => {
      void window.ziff.saveAnnotations({
        repoPath: snapshot.info.path,
        comparison,
        annotations,
      });
    }, 250);

    return () => {
      window.clearTimeout(saveAnnotationsTimerRef.current);
    };
  }, [annotations, annotationsReady, comparison, snapshot]);

  useEffect(() => {
    if (snapshot == null || sidebarTab !== "history") {
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

  function toggleAllPreviews() {
    setCollapsedPaths(allCollapsed ? new Set() : new Set(previewPaths));
  }

  function expandDiffContext(path: string) {
    const contextLines =
      (diffContextLines.get(path) ?? defaultDiffContextLines) + diffContextExpansionLines;
    setDiffContextLines((current) => {
      const next = new Map(current);
      next.set(path, contextLines);
      return next;
    });
    void window.ziff
      .getDiff({ path, comparison, contextLines })
      .then((diff) => {
        setDiffPreviews((current) =>
          current.map((item) =>
            item.file.path === path ? { type: "ready", file: item.file, diff } : item,
          ),
        );
      })
      .catch((error: unknown) => {
        setDiffPreviews((current) =>
          current.map((item) =>
            item.file.path === path
              ? { type: "error", file: item.file, message: getErrorMessage(error) }
              : item,
          ),
        );
      });
  }

  function selectPath(path: string) {
    setSelectedPath(path);
    setCollapsedPaths((current) => {
      if (!current.has(path)) {
        return current;
      }
      const next = new Set(current);
      next.delete(path);
      return next;
    });
  }

  function updateAnnotations(next: readonly Annotation[]) {
    setAnnotations(next);
  }

  function deleteAnnotation(id: string) {
    setAnnotations((current) => current.filter((annotation) => annotation.id !== id));
    setSelectedAnnotationId((current) => (current === id ? null : current));
  }

  function toggleAnnotationResolved(id: string) {
    setAnnotations((current) =>
      current.map((annotation) =>
        annotation.id === id ? { ...annotation, resolved: !annotation.resolved } : annotation,
      ),
    );
  }

  function selectAnnotation(id: string | null) {
    setSelectedAnnotationId(id);
    if (id != null) {
      const annotation = annotations.find((item) => item.id === id);
      if (annotation != null) {
        setSelectedPath(annotation.filePath);
        setSidebarTab("annotations");
        setCollapsedPaths((current) => {
          if (!current.has(annotation.filePath)) {
            return current;
          }
          const next = new Set(current);
          next.delete(annotation.filePath);
          return next;
        });
      }
    }
  }

  function updateSidebarSettings(patch: Partial<SidebarSettings>) {
    void window.ziff.updateSettings(patch).then(setSidebarSettings);
  }

  async function chooseRepo() {
    setLoadState({ type: "loading" });
    try {
      const next = await window.ziff.chooseRepo();
      if (next == null) {
        setLoadState({ type: "empty" });
        return;
      }
      setComparison(WORKING_TREE_COMPARISON);
      setLoadState({ type: "ready", snapshot: next });
      rememberProject(next.info.projectName, next.info.path, setRecentProjects);
      setSelectedPath(next.files[0]?.path ?? null);
    } catch (error) {
      setLoadState({ type: "error", message: getErrorMessage(error) });
    }
  }

  async function refresh() {
    const next =
      comparison.type === "working-tree"
        ? await window.ziff.refresh()
        : await window.ziff.getComparison(comparison);
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
    setComparison(WORKING_TREE_COMPARISON);
    setLoadState({ type: "ready", snapshot: next });
    rememberProject(next.info.projectName, next.info.path, setRecentProjects);
    setSelectedPath(next.files[0]?.path ?? null);
  }

  async function openProjectWindow(path: string) {
    setOpenHeaderMenu(null);
    await window.ziff.openProjectWindow(path);
  }

  async function switchBranch(branch: string) {
    setOpenHeaderMenu(null);
    setComparison(WORKING_TREE_COMPARISON);
    await replaceSnapshot(() => window.ziff.switchBranch(branch));
  }

  async function changeComparison(nextComparison: DiffComparison) {
    setComparison(nextComparison);
    try {
      const next =
        nextComparison.type === "working-tree"
          ? await window.ziff.refresh()
          : await window.ziff.getComparison(nextComparison);
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
    } catch (error) {
      setLoadState({ type: "error", message: getErrorMessage(error) });
    }
  }

  if (loadState.type === "loading") {
    return <Splash label="Loading" />;
  }

  if (loadState.type === "empty") {
    return (
      <Splash
        label="Open a local Git repo"
        onClick={chooseRepo}
        onOpenProject={(path) => void switchWorktree(path)}
        recentProjects={recentProjects}
      />
    );
  }

  if (loadState.type === "error") {
    return (
      <Splash
        label={loadState.message}
        onClick={chooseRepo}
        onOpenProject={(path) => void switchWorktree(path)}
        recentProjects={recentProjects}
      />
    );
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
          onForgetProject={(path) => forgetProject(path, setRecentProjects)}
          onMenuChange={setOpenHeaderMenu}
          onOpenProjectWindow={(path) => void openProjectWindow(path)}
          onSwitchBranch={(branch) => void switchBranch(branch)}
          onSwitchProject={(path) => void switchWorktree(path)}
          onSwitchWorktree={(path) => void switchWorktree(path)}
        />
        <button className="icon-button" title="Refresh" onClick={() => void refresh()}>
          <RefreshCw size={15} />
        </button>
      </header>

      <div
        className={sidebarVisible ? "workbench" : "workbench sidebar-hidden"}
        style={getWorkbenchStyle(sidebarWidth)}
      >
        <aside
          aria-hidden={!sidebarVisible}
          className={
            sidebarTab === "history"
              ? "sidebar history-active"
              : sidebarTab === "annotations"
                ? "sidebar annotations-active"
                : "sidebar"
          }
          inert={!sidebarVisible}
        >
          <section className="sidebar-tabs">
            <button
              className={sidebarTab === "changes" ? "tab active" : "tab"}
              onClick={() => setSidebarTab("changes")}
            >
              Changes ({loadState.snapshot.files.length})
            </button>
            <button
              className={sidebarTab === "annotations" ? "tab active" : "tab"}
              onClick={() => setSidebarTab("annotations")}
            >
              Notes ({annotations.filter((annotation) => !annotation.resolved).length})
            </button>
            <button
              className={sidebarTab === "history" ? "tab active" : "tab"}
              onClick={() => setSidebarTab("history")}
            >
              History
            </button>
          </section>
          {sidebarTab === "changes" ? (
            <ChangesPanel
              files={loadState.snapshot.files}
              fileGroupBy={sidebarSettings.fileGroupBy}
              fileListView={sidebarSettings.fileListView}
              readPaths={readPaths}
              selectedPath={selectedPath}
              totalsAdded={totals.added}
              totalsDeleted={totals.deleted}
              onFileGroupByChange={(fileGroupBy) => updateSidebarSettings({ fileGroupBy })}
              onFileListViewChange={(fileListView) => updateSidebarSettings({ fileListView })}
              onSelect={selectPath}
              onToggleRead={toggleRead}
              onToggleReadMany={setManyRead}
              onViewDiff={chooseRepo}
            />
          ) : sidebarTab === "annotations" ? (
            <AnnotationsPanel
              annotations={annotations}
              comparison={comparison}
              onDeleteAnnotation={deleteAnnotation}
              onSelectAnnotation={(id) => selectAnnotation(id)}
              onToggleResolved={toggleAnnotationResolved}
              selectedAnnotationId={selectedAnnotationId}
            />
          ) : (
            <HistoryList
              activeHash={comparison.type === "commit" ? comparison.hash : null}
              commits={commits}
              loading={historyLoading}
              onSelectCommit={(hash) => void changeComparison({ type: "commit", hash })}
            />
          )}
        </aside>
        <ResizeHandle
          defaultValue={defaultSidebarWidth}
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
              disabled={previewPaths.length === 0}
              title={allCollapsed ? "Expand previews" : "Collapse previews"}
              onClick={toggleAllPreviews}
            >
              {allCollapsed ? <ChevronsUpDown size={16} /> : <ChevronsDownUp size={16} />}
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
            <ComparisonControls
              comparison={comparison}
              info={loadState.snapshot.info}
              onChange={(nextComparison) => void changeComparison(nextComparison)}
            />
          </div>
          <DiffPreviewList
            annotations={annotations}
            previews={diffPreviews}
            collapsedPaths={collapsedPaths}
            comparison={comparison}
            readPaths={readPaths}
            selectedPath={selectedPath}
            selectedAnnotationId={selectedAnnotationId}
            leftWidth={leftWidth}
            mode={effectiveViewMode}
            onAnnotationsChange={updateAnnotations}
            onOpenFile={(path) => void window.ziff.openFile(path)}
            onExpandContext={expandDiffContext}
            onResize={setLeftWidth}
            onSelect={selectPath}
            onSelectAnnotation={selectAnnotation}
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

function shouldRestoreInitialProject(): boolean {
  return new URLSearchParams(window.location.search).get("restoreProject") !== "0";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}
