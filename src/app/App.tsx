import { RefreshCw } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SPLIT_WIDTH,
  DiffPanel,
  RepoHeader,
  ResizeHandle,
  Sidebar,
  Splash,
} from "./components";
import { formatAnnotationsForAgentPrompt } from "../annotations";
import { getTotals } from "./diffModel";
import { resolveAppHotkey } from "./hotkeys";
import { forgetProject, readRecentProjects, rememberProject } from "./recentProjects";
import type { DiffPreview, LoadState, RecentProject } from "./types";
import type {
  Annotation,
  AnnotationAnchor,
  AnnotationAuthor,
  AnnotationKind,
  AnnotationStatus,
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
type AnnotationEditorState =
  | { type: "create"; anchor: AnnotationAnchor; kind: AnnotationKind }
  | { type: "edit"; annotation: Annotation };
type AnnotationSelectionMode = "extend" | "range" | "replace";
const defaultAnnotationAuthor: AnnotationAuthor = { name: "You", avatarUrl: null };

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
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [annotations, setAnnotations] = useState<readonly Annotation[]>([]);
  const [annotationAuthor, setAnnotationAuthor] =
    useState<AnnotationAuthor>(defaultAnnotationAuthor);
  const [annotationKind, setAnnotationKind] = useState<AnnotationKind>("review");
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [annotationEditor, setAnnotationEditor] = useState<AnnotationEditorState | null>(null);
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
  const diffPanelRef = useRef<HTMLElement | null>(null);
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
    function handleKeyDown(event: KeyboardEvent) {
      const action = resolveAppHotkey(event);
      if (action !== "toggleSidebar") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setSidebarVisible((visible) => !visible);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
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
      setAnnotationAuthor(defaultAnnotationAuthor);
      setSelectedAnnotationId(null);
      return;
    }

    let active = true;
    void window.ziff.getAnnotations(comparison).then((nextAnnotations) => {
      if (active) {
        setAnnotations(nextAnnotations);
      }
    });
    void window.ziff.getAnnotationAuthor().then((nextAuthor) => {
      if (active) {
        setAnnotationAuthor(nextAuthor);
      }
    });
    return () => {
      active = false;
    };
  }, [snapshot, comparison]);

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

  function selectAnnotation(annotation: Annotation) {
    setSelectedAnnotationId(annotation.id);
    selectPath(annotation.file);
  }

  function startAnnotation(anchor: AnnotationAnchor, mode: AnnotationSelectionMode) {
    setAnnotationEditor((current) => {
      if (mode === "replace") {
        return { type: "create", anchor, kind: annotationKind };
      }
      if (
        mode === "range" &&
        current?.type === "create" &&
        current.anchor.file === anchor.file &&
        current.anchor.side === anchor.side
      ) {
        if (
          current.anchor.lineStart === anchor.lineStart &&
          current.anchor.lineEnd === anchor.lineEnd
        ) {
          return current;
        }
        return { ...current, anchor };
      }
      if (
        mode === "extend" &&
        current?.type === "create" &&
        current.anchor.file === anchor.file &&
        current.anchor.side === anchor.side
      ) {
        return { ...current, anchor: mergeAnnotationAnchors(current.anchor, anchor) };
      }
      if (current != null) {
        return current;
      }
      return { type: "create", anchor, kind: annotationKind };
    });
  }

  async function saveAnnotation(kind: AnnotationKind, body: string) {
    if (annotationEditor == null) {
      return;
    }
    if (annotationEditor.type === "create") {
      const created = await window.ziff.createAnnotation({
        ...annotationEditor.anchor,
        comparison,
        kind,
        body,
      });
      setAnnotations((current) => [...current, created]);
      setSelectedAnnotationId(created.id);
      setAnnotationEditor(null);
      return;
    }

    const updated = await window.ziff.updateAnnotation({
      id: annotationEditor.annotation.id,
      kind,
      body,
    });
    setAnnotations((current) =>
      current.map((annotation) => (annotation.id === updated.id ? updated : annotation)),
    );
    setAnnotationEditor(null);
  }

  async function deleteAnnotation(id: string) {
    await window.ziff.deleteAnnotation(id);
    setAnnotations((current) => current.filter((annotation) => annotation.id !== id));
    setSelectedAnnotationId((current) => (current === id ? null : current));
  }

  async function toggleAnnotationResolved(annotation: Annotation) {
    const status: AnnotationStatus =
      annotation.status.state === "open"
        ? { state: "resolved", resolvedAt: new Date().toISOString() }
        : { state: "open" };
    const updated = await window.ziff.updateAnnotation({ id: annotation.id, status });
    setAnnotations((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  async function copyAnnotationsPrompt(selectedAnnotations: readonly Annotation[]) {
    if (snapshot == null) {
      return;
    }
    const text = formatAnnotationsForAgentPrompt(selectedAnnotations, comparison, snapshot.info);
    await navigator.clipboard.writeText(text);
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
    const next = await window.ziff.switchWorktree(path);
    setComparison(WORKING_TREE_COMPARISON);
    setLoadState({ type: "ready", snapshot: next });
    rememberProject(next.info.projectName, next.info.path, setRecentProjects);
    setSelectedPath(next.files[0]?.path ?? null);
  }

  async function openProjectWindow(path: string) {
    await window.ziff.openProjectWindow(path);
  }

  async function switchBranch(branch: string) {
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
          recentProjects={recentProjects}
          snapshot={loadState.snapshot}
          onChooseRepo={() => void chooseRepo()}
          onForgetProject={(path) => forgetProject(path, setRecentProjects)}
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
        <Sidebar
          annotationKind={annotationKind}
          annotations={annotations}
          comparison={comparison}
          fileGroupBy={sidebarSettings.fileGroupBy}
          fileListView={sidebarSettings.fileListView}
          readPaths={readPaths}
          selectedAnnotationId={selectedAnnotationId}
          selectedPath={selectedPath}
          snapshot={loadState.snapshot}
          totalsAdded={totals.added}
          totalsDeleted={totals.deleted}
          visible={sidebarVisible}
          onAnnotationKindChange={setAnnotationKind}
          onChangeComparison={(nextComparison) => void changeComparison(nextComparison)}
          onCopyPrompt={(selectedAnnotations) => void copyAnnotationsPrompt(selectedAnnotations)}
          onDeleteAnnotation={(id) => void deleteAnnotation(id)}
          onEditAnnotation={(annotation) => setAnnotationEditor({ type: "edit", annotation })}
          onFileGroupByChange={(fileGroupBy) => updateSidebarSettings({ fileGroupBy })}
          onFileListViewChange={(fileListView) => updateSidebarSettings({ fileListView })}
          onSelectAnnotation={selectAnnotation}
          onSelectPath={selectPath}
          onToggleAnnotationResolved={(annotation) => void toggleAnnotationResolved(annotation)}
          onToggleRead={toggleRead}
          onToggleReadMany={setManyRead}
          onViewDiff={chooseRepo}
        />
        <ResizeHandle
          defaultValue={defaultSidebarWidth}
          label="Resize changes panel"
          max={560}
          min={260}
          onResize={setSidebarWidth}
          value={sidebarWidth}
        />

        <DiffPanel
          allCollapsed={allCollapsed}
          annotationAuthor={annotationAuthor}
          annotationEditor={annotationEditor}
          annotations={annotations}
          collapsedPaths={collapsedPaths}
          comparison={comparison}
          diffPanelRef={diffPanelRef}
          effectiveViewMode={effectiveViewMode}
          info={loadState.snapshot.info}
          isDiffPanelNarrow={isDiffPanelNarrow}
          leftWidth={leftWidth}
          previewPaths={previewPaths}
          previews={diffPreviews}
          readPaths={readPaths}
          selectedAnnotationId={selectedAnnotationId}
          selectedPath={selectedPath}
          onAddAnnotation={startAnnotation}
          onCancelAnnotation={() => setAnnotationEditor(null)}
          onChangeComparison={(nextComparison) => void changeComparison(nextComparison)}
          onDeleteAnnotation={(id) => void deleteAnnotation(id)}
          onEditAnnotation={(annotation) => setAnnotationEditor({ type: "edit", annotation })}
          onExpandContext={expandDiffContext}
          onOpenFile={(path) => void window.ziff.openFile(path)}
          onResize={setLeftWidth}
          onSaveAnnotation={(kind, body) => void saveAnnotation(kind, body)}
          onSelect={selectPath}
          onSelectAnnotation={selectAnnotation}
          onToggleAllPreviews={toggleAllPreviews}
          onToggleAnnotationResolved={(annotation) => void toggleAnnotationResolved(annotation)}
          onTogglePreview={togglePreview}
          onToggleRead={toggleRead}
          onViewModeChange={setViewMode}
        />
      </div>
    </main>
  );
}

function getWorkbenchStyle(sidebarWidth: number): WorkbenchStyle {
  return { "--sidebar-width": `${sidebarWidth}px` };
}

function mergeAnnotationAnchors(
  first: AnnotationAnchor,
  second: AnnotationAnchor,
): AnnotationAnchor {
  return {
    file: first.file,
    lineStart: Math.min(first.lineStart, second.lineStart),
    lineEnd: Math.max(first.lineEnd, second.lineEnd),
    side: first.side,
  };
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
