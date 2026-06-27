export type ChangeKind = "added" | "deleted" | "modified" | "renamed" | "untracked";

export type ChangeArea = "staged" | "unstaged" | "untracked";

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
  rows: readonly SplitDiffRow[];
}

export interface FileDiff {
  path: string;
  previousPath: string | null;
  hunks: readonly DiffHunk[];
  isBinary: boolean;
}

export type ViewMode = "split" | "stacked";

export interface CommitRequest {
  message: string;
}

export interface ZiffApi {
  chooseRepo(): Promise<RepoSnapshot | null>;
  commit(request: CommitRequest): Promise<RepoSnapshot>;
  getDiff(path: string): Promise<FileDiff>;
  getSnapshot(): Promise<RepoSnapshot | null>;
  openFile(path: string): Promise<void>;
  refresh(): Promise<RepoSnapshot | null>;
  stage(path: string): Promise<RepoSnapshot>;
  stageAll(): Promise<RepoSnapshot>;
  switchBranch(branch: string): Promise<RepoSnapshot>;
  switchWorktree(path: string): Promise<RepoSnapshot>;
  unstage(path: string): Promise<RepoSnapshot>;
}
