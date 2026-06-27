import {
  Check,
  ChevronDown,
  ChevronRight,
  Columns2,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  List,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Rows3,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DiffHunk, FileDiff, GitFileEntry, RepoSnapshot, SplitDiffRow, ViewMode } from "./shared";

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

const formatter = new Intl.NumberFormat("en-US");

export function App() {
  const [loadState, setLoadState] = useState<LoadState>({ type: "loading" });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [leftWidth, setLeftWidth] = useState(50);
  const [commitMessage, setCommitMessage] = useState("");

  useEffect(() => {
    void window.ziff.getSnapshot().then((snapshot) => {
      if (snapshot == null) {
        setLoadState({ type: "empty" });
      } else {
        setLoadState({ type: "ready", snapshot });
        setSelectedPath(snapshot.files[0]?.path ?? null);
      }
    });
  }, []);

  useEffect(() => {
    if (selectedPath == null) {
      setDiff(null);
      return;
    }
    let active = true;
    void window.ziff.getDiff(selectedPath).then((nextDiff) => {
      if (active) {
        setDiff(nextDiff);
      }
    });
    return () => {
      active = false;
    };
  }, [selectedPath]);

  const snapshot = loadState.type === "ready" ? loadState.snapshot : null;
  const selectedFile = snapshot?.files.find((file) => file.path === selectedPath) ?? null;
  const totals = useMemo(() => getTotals(snapshot?.files ?? []), [snapshot]);

  async function chooseRepo() {
    setLoadState({ type: "loading" });
    try {
      const next = await window.ziff.chooseRepo();
      if (next == null) {
        setLoadState({ type: "empty" });
        return;
      }
      setLoadState({ type: "ready", snapshot: next });
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
    if (selectedPath == null || next.files.every((file) => file.path !== selectedPath)) {
      setSelectedPath(next.files[0]?.path ?? null);
    }
  }

  async function replaceSnapshot(action: () => Promise<RepoSnapshot>) {
    const next = await action();
    setLoadState({ type: "ready", snapshot: next });
    if (selectedPath == null || next.files.every((file) => file.path !== selectedPath)) {
      setSelectedPath(next.files[0]?.path ?? null);
    }
  }

  async function commit() {
    if (commitMessage.trim().length === 0) {
      return;
    }
    await replaceSnapshot(() => window.ziff.commit({ message: commitMessage }));
    setCommitMessage("");
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
        <div className="brand">ziff</div>
        <GitBranch size={14} />
        <span>{loadState.snapshot.info.branch}</span>
        <span className="repo-path">{loadState.snapshot.info.path}</span>
        <button className="icon-button" title="Refresh" onClick={() => void refresh()}>
          <RefreshCw size={15} />
        </button>
      </header>

      <div className="workbench">
        {sidebarOpen ? (
          <aside className="sidebar">
            <section className="sidebar-tabs">
              <button className="tab active">Changes ({loadState.snapshot.files.length})</button>
              <button className="tab">History</button>
            </section>
            <section className="sidebar-actions">
              <button className="link-button" onClick={chooseRepo}>View Diff</button>
              <span className="positive">+{formatter.format(totals.added)}</span>
              <span className="negative">-{formatter.format(totals.deleted)}</span>
              <button className="small-button" onClick={() => void replaceSnapshot(window.ziff.stageAll)}>Stage All</button>
            </section>
            <FileTree
              files={loadState.snapshot.files}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
            />
            <section className="commit-panel">
              <textarea
                aria-label="Commit message"
                placeholder="Enter commit message"
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
              />
              <button className="primary-button" onClick={() => void commit()}>
                <GitCommitHorizontal size={15} />
                Commit Staged
              </button>
            </section>
          </aside>
        ) : null}

        <section className="diff-panel">
          <div className="diff-toolbar">
            <button className="icon-button" title={sidebarOpen ? "Hide changes" : "Show changes"} onClick={() => setSidebarOpen(!sidebarOpen)}>
              {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </button>
            <button className="icon-button" title={allCollapsed ? "Expand all" : "Collapse all"} onClick={() => setAllCollapsed(!allCollapsed)}>
              {allCollapsed ? <List size={16} /> : <Minus size={16} />}
            </button>
            <div className="segmented" aria-label="Diff layout">
              <button className={viewMode === "stacked" ? "active" : ""} onClick={() => setViewMode("stacked")} title="Stacked diff">
                <Rows3 size={16} />
              </button>
              <button className={viewMode === "split" ? "active" : ""} onClick={() => setViewMode("split")} title="Split diff">
                <Columns2 size={16} />
              </button>
            </div>
            <div className="toolbar-spacer" />
            {selectedFile != null ? (
              <>
                <button className="toolbar-button" onClick={() => void replaceSnapshot(() => window.ziff.stage(selectedFile.path))}>Stage</button>
                <button className="toolbar-button" onClick={() => void replaceSnapshot(() => window.ziff.unstage(selectedFile.path))}>Unstage</button>
                <button className="toolbar-button" onClick={() => void window.ziff.openFile(selectedFile.path)}>Open File</button>
              </>
            ) : null}
          </div>
          <DiffHeader file={selectedFile} />
          <DiffView
            collapsed={allCollapsed}
            diff={diff}
            leftWidth={leftWidth}
            mode={viewMode}
            onResize={setLeftWidth}
          />
        </section>
      </div>
    </main>
  );
}

function Splash({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <main className="splash">
      <div className="brand large">ziff</div>
      <p>{label}</p>
      {onClick == null ? null : <button className="primary-button" onClick={onClick}>Open Repo</button>}
    </main>
  );
}

function FileTree({ files, selectedPath, onSelect }: {
  files: readonly GitFileEntry[];
  selectedPath: string | null;
  onSelect(path: string): void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  return (
    <section className="file-list">
      <div className="group-title">Tracked</div>
      {tree.map((node) => (
        <TreeNode key={node.path} node={node} selectedPath={selectedPath} onSelect={onSelect} depth={0} />
      ))}
    </section>
  );
}

function TreeNode({ node, selectedPath, onSelect, depth }: {
  node: FileTreeNode;
  selectedPath: string | null;
  onSelect(path: string): void;
  depth: number;
}) {
  const [open, setOpen] = useState(true);
  if (node.kind === "folder") {
    return (
      <div>
        <button className="tree-row folder-row" style={{ paddingLeft: 10 + depth * 16 }} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {open ? <FolderOpen size={14} /> : <Folder size={14} />}
          <span>{node.name}</span>
          <span className="tree-stats"><span className="positive">+{node.added}</span><span className="negative">-{node.deleted}</span></span>
        </button>
        {open ? node.children.map((child) => (
          <TreeNode key={child.path} node={child} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} />
        )) : null}
      </div>
    );
  }

  return (
    <button className={node.path === selectedPath ? "tree-row selected" : "tree-row"} style={{ paddingLeft: 28 + depth * 16 }} onClick={() => onSelect(node.path)}>
      <FileCode2 size={14} />
      <span>{node.name}</span>
      <span className="tree-stats"><span className="positive">+{node.file.added}</span><span className="negative">-{node.file.deleted}</span></span>
      {node.file.areas.includes("staged") ? <Check size={13} className="staged-mark" /> : null}
    </button>
  );
}

function DiffHeader({ file }: { file: GitFileEntry | null }) {
  if (file == null) {
    return <div className="file-header">No changes</div>;
  }
  const name = getBasename(file.path);
  const directory = getDirectory(file.path);
  return (
    <div className="file-header">
      <ChevronDown size={16} />
      <FileCode2 size={16} />
      <strong>{name}</strong>
      <span>{directory}</span>
      <span className="chip">{file.kind}</span>
    </div>
  );
}

function DiffView({ collapsed, diff, leftWidth, mode, onResize }: {
  collapsed: boolean;
  diff: FileDiff | null;
  leftWidth: number;
  mode: ViewMode;
  onResize(width: number): void;
}) {
  if (diff == null) {
    return <section className="diff-empty">Select a file</section>;
  }
  if (diff.isBinary) {
    return <section className="diff-empty">Binary file</section>;
  }
  if (collapsed) {
    return <section className="diff-empty">{diff.hunks.length} hunks collapsed</section>;
  }
  return (
    <section className="diff-body">
      {diff.hunks.map((hunk) => (
        <HunkView key={hunk.header} hunk={hunk} leftWidth={leftWidth} mode={mode} onResize={onResize} />
      ))}
    </section>
  );
}

function HunkView({ hunk, leftWidth, mode, onResize }: {
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
      <div className="hunk-header split-header" style={{ gridTemplateColumns: `${leftWidth}% 1fr` }}>{hunk.header}</div>
      {hunk.rows.map((row, index) => (
        <SplitRow key={`${index}-${lineKey(row)}`} leftWidth={leftWidth} row={row} />
      ))}
      <input
        aria-label="Resize split diff"
        className="resize-slider"
        max={72}
        min={28}
        onChange={(event) => onResize(Number.parseInt(event.target.value, 10))}
        style={{ left: `calc(${leftWidth}% - 8px)` }}
        type="range"
        value={leftWidth}
      />
    </section>
  );
}

function SplitRow({ leftWidth, row }: { leftWidth: number; row: SplitDiffRow }) {
  const style = { gridTemplateColumns: `${leftWidth}% 1fr` };
  if (row.kind === "context") {
    return (
      <div className="split-row" style={style}>
        <CodeCell side="old" line={row.oldLine} text={row.text} tone="context" />
        <CodeCell side="new" line={row.newLine} text={row.text} tone="context" />
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
      <CodeCell side="old" line={row.oldLine} text={row.oldText} tone="delete" />
      <CodeCell side="new" line={row.newLine} text={row.newText} tone="add" />
    </div>
  );
}

function renderStackedRow(row: SplitDiffRow, index: number) {
  if (row.kind === "context") {
    return [<CodeCell key={index} side="both" line={row.newLine} text={row.text} tone="context" />];
  }
  if (row.kind === "delete") {
    return [<CodeCell key={index} side="both" line={row.oldLine} text={`- ${row.text}`} tone="delete" />];
  }
  if (row.kind === "add") {
    return [<CodeCell key={index} side="both" line={row.newLine} text={`+ ${row.text}`} tone="add" />];
  }
  return [
    <CodeCell key={`${index}-old`} side="both" line={row.oldLine} text={`- ${row.oldText}`} tone="delete" />,
    <CodeCell key={`${index}-new`} side="both" line={row.newLine} text={`+ ${row.newText}`} tone="add" />,
  ];
}

function CodeCell({ line, side, text, tone }: {
  line: number | null;
  side: "old" | "new" | "both";
  text: string;
  tone: "add" | "context" | "delete" | "empty";
}) {
  return (
    <div className={`code-cell ${side} ${tone}`}>
      <span className="line-number">{line ?? ""}</span>
      <code>{text}</code>
    </div>
  );
}

function buildTree(files: readonly GitFileEntry[]): readonly FileTreeNode[] {
  const root: TreeFolder = createFolder("", "");
  for (const file of files) {
    insertFile(root, file.path.split("/"), file);
  }
  return root.children;
}

interface TreeFolder {
  children: FileTreeNode[];
  name: string;
  path: string;
}

function createFolder(name: string, path: string): TreeFolder {
  return { name, path, children: [] };
}

function insertFile(folder: TreeFolder, parts: readonly string[], file: GitFileEntry): void {
  const [head, ...tail] = parts;
  if (head == null) {
    return;
  }
  if (tail.length === 0) {
    folder.children.push({ kind: "file", name: head, path: file.path, file });
    return;
  }

  const nextPath = folder.path.length === 0 ? head : `${folder.path}/${head}`;
  let existing = folder.children.find((node) => node.kind === "folder" && node.path === nextPath);
  if (existing == null || existing.kind !== "folder") {
    existing = { kind: "folder", name: head, path: nextPath, children: [], added: 0, deleted: 0 };
    folder.children.push(existing);
  }
  insertFile(
    { name: existing.name, path: existing.path, children: existing.children },
    tail,
    file
  );
  existing.added += file.added;
  existing.deleted += file.deleted;
}

function getTotals(files: readonly GitFileEntry[]) {
  return files.reduce(
    (totals, file) => ({
      added: totals.added + file.added,
      deleted: totals.deleted + file.deleted,
    }),
    { added: 0, deleted: 0 }
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}
