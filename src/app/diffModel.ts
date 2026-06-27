import type { GitFileEntry, SplitDiffRow } from "../shared";
import type { FileGroupBy, FileListView, FileTreeNode } from "./types";

export interface FileGroup {
  files: readonly GitFileEntry[];
  label: string | null;
  nodes: readonly FileTreeNode[];
}

export type InlineFragment = {
  text: string;
  highlighted: boolean;
};

export type ColoredSegment = {
  text: string;
  color?: string;
  highlighted: boolean;
};

type SyntaxToken = {
  content: string;
  color?: string;
};

type FragmentSide = "old" | "new";

type TokenEdit =
  | { kind: "same"; oldToken: string; newToken: string }
  | { kind: "delete"; token: string }
  | { kind: "add"; token: string };

export function getInlineFragments(
  oldText: string,
  newText: string,
  side: FragmentSide,
): readonly InlineFragment[] {
  const edits = diffTokens(tokenizeForInlineDiff(oldText), tokenizeForInlineDiff(newText));
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

export function withPrefix(
  prefix: string,
  fragments: readonly InlineFragment[],
): readonly InlineFragment[] {
  return [{ text: prefix, highlighted: false }, ...fragments];
}

export function mergeSyntax(
  content: string,
  tokens: readonly SyntaxToken[],
  fragments: readonly InlineFragment[],
): readonly ColoredSegment[] {
  const colors = expand(tokens, (token) => token.content.length, (token) => token.color);
  const highlights = expand(fragments, (fragment) => fragment.text.length, (fragment) => fragment.highlighted);

  const segments: ColoredSegment[] = [];
  for (let index = 0; index < content.length; index += 1) {
    const color = colors[index];
    const highlighted = highlights[index] ?? false;
    const last = segments.at(-1);
    if (last != null && last.color === color && last.highlighted === highlighted) {
      last.text += content[index];
    } else {
      segments.push({ text: content[index] ?? "", color, highlighted });
    }
  }
  return segments;
}

function expand<T, V>(
  items: readonly T[],
  length: (item: T) => number,
  value: (item: T) => V,
): V[] {
  const result: V[] = [];
  for (const item of items) {
    const itemValue = value(item);
    for (let index = 0; index < length(item); index += 1) {
      result.push(itemValue);
    }
  }
  return result;
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
        rows[oldIndex][newIndex] = getDistance(rows, oldIndex + 1, newIndex + 1) + 1;
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

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function groupFiles(files: readonly GitFileEntry[]) {
  return organizeFiles(files, { fileGroupBy: "status", fileListView: "tree" });
}

export function organizeFiles(
  files: readonly GitFileEntry[],
  options: { fileGroupBy: FileGroupBy; fileListView: FileListView },
): readonly FileGroup[] {
  const { fileGroupBy, fileListView } = options;

  if (fileGroupBy === "status") {
    const tracked = files.filter((file) => !isUntracked(file));
    const untracked = files.filter(isUntracked);
    const groups: FileGroup[] = [];
    if (tracked.length > 0) {
      groups.push(createFileGroup("Tracked", tracked, fileListView));
    }
    if (untracked.length > 0) {
      groups.push(createFileGroup("Untracked", untracked, fileListView));
    }
    return groups;
  }

  if (files.length === 0) {
    return [];
  }

  return [createFileGroup(null, files, fileListView)];
}

function createFileGroup(
  label: string | null,
  files: readonly GitFileEntry[],
  fileListView: FileListView,
): FileGroup {
  return {
    label,
    files: fileListView === "list" ? sortFiles(files) : [],
    nodes: fileListView === "tree" ? buildTree(files) : [],
  };
}

function sortFiles(files: readonly GitFileEntry[]): readonly GitFileEntry[] {
  return [...files].toSorted((left, right) =>
    left.path.localeCompare(right.path, undefined, { sensitivity: "base" }),
  );
}

function isUntracked(file: GitFileEntry): boolean {
  return file.areas.includes("untracked");
}

export function collectFilePaths(node: FileTreeNode): readonly string[] {
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
  return sortTree(compactTree(root.children));
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
  insertFile({ name: existing.name, path: existing.path, children: existing.children }, tail, file);
  existing.added += file.added;
  existing.deleted += file.deleted;
}

function compactTree(nodes: readonly FileTreeNode[]): FileTreeNode[] {
  return nodes.map((node): FileTreeNode => {
    if (node.kind === "file") {
      return node;
    }
    return compactFolder(node);
  });
}

function compactFolder(folder: Extract<FileTreeNode, { kind: "folder" }>): FileTreeNode {
  const children = compactTree(folder.children);
  const onlyChild = children.length === 1 ? children[0] : null;
  if (onlyChild == null || onlyChild.kind === "file") {
    return { ...folder, children };
  }
  return {
    ...onlyChild,
    name: `${folder.name}/${onlyChild.name}`,
  };
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

export function getTotals(files: readonly GitFileEntry[]) {
  return files.reduce(
    (totals, file) => ({
      added: totals.added + file.added,
      deleted: totals.deleted + file.deleted,
    }),
    { added: 0, deleted: 0 },
  );
}

export function getBasename(path: string): string {
  const parts = path.split("/");
  return parts.at(-1) ?? path;
}

export function getDirectory(path: string): string {
  const name = getBasename(path);
  if (name === path) {
    return "";
  }
  return path.slice(0, path.length - name.length);
}

export function getPrimaryArea(areas: GitFileEntry["areas"]): string {
  return areas[0] ?? "unstaged";
}

export function lineKey(row: SplitDiffRow): string {
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
