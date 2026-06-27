import type { FileDiff, GitFileEntry, RepoSnapshot } from "../shared";

export type FileTreeNode =
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

export type LoadState =
  | { type: "empty" }
  | { type: "loading" }
  | { type: "ready"; snapshot: RepoSnapshot }
  | { type: "error"; message: string };

export type DiffPreview =
  | { type: "loading"; file: GitFileEntry }
  | { type: "ready"; file: GitFileEntry; diff: FileDiff }
  | { type: "error"; file: GitFileEntry; message: string };

export type HeaderMenu = "project" | "worktree" | "branch";

export interface RecentProject {
  name: string;
  path: string;
}
