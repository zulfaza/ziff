export type ChangeKind = "added" | "deleted" | "modified" | "renamed" | "untracked";

export type ChangeArea = "staged" | "unstaged" | "untracked" | "comparison";

export interface GitFileEntry {
  path: string;
  previousPath: string | null;
  kind: ChangeKind;
  areas: readonly ChangeArea[];
  added: number;
  deleted: number;
}

export interface RepoInfo {
  branch: string;
  path: string;
  projectName: string;
  worktree: string;
  worktrees: readonly WorktreeEntry[];
  branches: readonly BranchEntry[];
}

export interface WorktreeEntry {
  branch: string;
  isCurrent: boolean;
  name: string;
  path: string;
  shortHead: string;
}

export interface BranchEntry {
  author: string;
  isCurrent: boolean;
  name: string;
  relativeTime: string;
  subject: string;
}

export interface RepoSnapshot {
  info: RepoInfo;
  files: readonly GitFileEntry[];
}

export interface CommitEntry {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  relativeTime: string;
  subject: string;
}

export type SplitDiffRow =
  | {
      kind: "context";
      oldLine: number;
      newLine: number;
      text: string;
    }
  | {
      kind: "delete";
      oldLine: number;
      text: string;
    }
  | {
      kind: "add";
      newLine: number;
      text: string;
    }
  | {
      kind: "modify";
      oldLine: number;
      newLine: number;
      oldText: string;
      newText: string;
    };

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  rows: readonly SplitDiffRow[];
}

export interface FileDiff {
  path: string;
  previousPath: string | null;
  hunks: readonly DiffHunk[];
  isBinary: boolean;
}

export type ImagePreviewMimeType =
  | "image/avif"
  | "image/gif"
  | "image/jpeg"
  | "image/png"
  | "image/svg+xml"
  | "image/webp";

export interface ImagePreviewSide {
  dataUrl: string;
  mimeType: ImagePreviewMimeType;
}

export interface ImagePreview {
  after: ImagePreviewSide | null;
  before: ImagePreviewSide | null;
}

export type ViewMode = "split" | "stacked";

export type FileListView = "list" | "tree";

export type FileGroupBy = "none" | "status";

export interface SidebarSettings {
  fileGroupBy: FileGroupBy;
  fileListView: FileListView;
}

export interface CommitRequest {
  message: string;
}

export type DiffComparison =
  | { type: "working-tree" }
  | { type: "branch"; base: string; head: string }
  | { type: "commit"; hash: string };

export interface DiffRequest {
  comparison: DiffComparison;
  contextLines: number;
  path: string;
}

export interface ImagePreviewRequest {
  comparison: DiffComparison;
  path: string;
  previousPath: string | null;
}

export interface ZiffApi {
  chooseRepo(): Promise<RepoSnapshot | null>;
  commit(request: CommitRequest): Promise<RepoSnapshot>;
  getComparison(comparison: DiffComparison): Promise<RepoSnapshot>;
  getDiff(request: DiffRequest): Promise<FileDiff>;
  getImagePreview(request: ImagePreviewRequest): Promise<ImagePreview>;
  getHistory(): Promise<readonly CommitEntry[]>;
  getSettings(): Promise<SidebarSettings>;
  getSnapshot(): Promise<RepoSnapshot | null>;
  openFile(path: string): Promise<void>;
  openProjectWindow(path: string): Promise<void>;
  refresh(): Promise<RepoSnapshot | null>;
  stage(path: string): Promise<RepoSnapshot>;
  stageAll(): Promise<RepoSnapshot>;
  switchBranch(branch: string): Promise<RepoSnapshot>;
  switchWorktree(path: string): Promise<RepoSnapshot>;
  unstage(path: string): Promise<RepoSnapshot>;
  updateSettings(settings: Partial<SidebarSettings>): Promise<SidebarSettings>;
}
