import type {
  ChangeArea,
  ChangeKind,
  DiffHunk,
  FileDiff,
  GitFileEntry,
  SplitDiffRow,
} from "./shared";

interface PorcelainEntry {
  path: string;
  previousPath: string | null;
  x: string;
  y: string;
}

interface NameStatusEntry {
  path: string;
  previousPath: string | null;
  status: string;
}

interface LineStat {
  added: number;
  deleted: number;
}

interface HunkState {
  header: string;
  oldStart: number;
  oldLines: number;
  oldLine: number;
  newStart: number;
  newLines: number;
  newLine: number;
  rows: SplitDiffRow[];
  pendingDeletes: readonly PendingDelete[];
}

interface PendingDelete {
  oldLine: number;
  text: string;
}

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parsePorcelainStatus(output: string): readonly PorcelainEntry[] {
  const records = output.split("\0").filter((record) => record.length > 0);
  const entries: PorcelainEntry[] = [];
  let index = 0;

  while (index < records.length) {
    const record = records[index];
    if (record == null || record.length < 4) {
      index += 1;
      continue;
    }

    const x = record[0] ?? " ";
    const y = record[1] ?? " ";
    const path = normalizePorcelainPath(record.slice(3));
    if (x === "R" || x === "C") {
      const previousRecord = records[index + 1] ?? null;
      const previousPath = previousRecord == null ? null : normalizePorcelainPath(previousRecord);
      entries.push({ path, previousPath, x, y });
      index += 2;
    } else {
      entries.push({ path, previousPath: null, x, y });
      index += 1;
    }
  }

  return entries;
}

function normalizePorcelainPath(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") {
    end -= 1;
  }
  return path.slice(0, end);
}

export function parseNumStat(output: string): ReadonlyMap<string, LineStat> {
  const stats = new Map<string, LineStat>();
  for (const line of output.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }

    const [addedText, deletedText, path] = line.split("\t");
    if (addedText == null || deletedText == null || path == null) {
      continue;
    }

    const added = Number.parseInt(addedText, 10);
    const deleted = Number.parseInt(deletedText, 10);
    stats.set(path, {
      added: Number.isFinite(added) ? added : 0,
      deleted: Number.isFinite(deleted) ? deleted : 0,
    });
  }

  return stats;
}

export function buildFileEntries(
  statusOutput: string,
  stagedNumStat: string,
  unstagedNumStat: string,
  untrackedFilesOutput = "",
): readonly GitFileEntry[] {
  const stagedStats = parseNumStat(stagedNumStat);
  const unstagedStats = parseNumStat(unstagedNumStat);
  const untrackedFiles = parseUntrackedFiles(untrackedFilesOutput);

  return parsePorcelainStatus(statusOutput).flatMap((entry): readonly GitFileEntry[] => {
    if (entry.x === "?" && entry.y === "?") {
      const children = untrackedFiles.filter((path) => path.startsWith(`${entry.path}/`));
      if (children.length > 0) {
        return children.map((path) =>
          buildFileEntry({ ...entry, path }, stagedStats, unstagedStats),
        );
      }
    }
    return [buildFileEntry(entry, stagedStats, unstagedStats)];
  });
}

export function buildComparisonFileEntries(
  nameStatusOutput: string,
  numStatOutput: string,
): readonly GitFileEntry[] {
  const stats = parseNumStat(numStatOutput);
  return parseNameStatus(nameStatusOutput).map((entry): GitFileEntry => {
    const stat = stats.get(entry.path);
    return {
      path: entry.path,
      previousPath: entry.previousPath,
      kind: getNameStatusChangeKind(entry.status),
      areas: ["comparison"],
      added: stat?.added ?? 0,
      deleted: stat?.deleted ?? 0,
    };
  });
}

export function parseNameStatus(output: string): readonly NameStatusEntry[] {
  const records = output.split("\0").filter((record) => record.length > 0);
  const entries: NameStatusEntry[] = [];
  let index = 0;

  while (index < records.length) {
    const status = records[index];
    if (status == null || status.length === 0) {
      index += 1;
      continue;
    }

    if (status.startsWith("R") || status.startsWith("C")) {
      const previousPath = records[index + 1];
      const path = records[index + 2];
      if (previousPath != null && path != null) {
        entries.push({ path, previousPath, status });
      }
      index += 3;
      continue;
    }

    const path = records[index + 1];
    if (path != null) {
      entries.push({ path, previousPath: null, status });
    }
    index += 2;
  }

  return entries;
}

function buildFileEntry(
  entry: PorcelainEntry,
  stagedStats: ReadonlyMap<string, LineStat>,
  unstagedStats: ReadonlyMap<string, LineStat>,
): GitFileEntry {
  const areas = getChangeAreas(entry);
  const staged = stagedStats.get(entry.path);
  const unstaged = unstagedStats.get(entry.path);
  return {
    path: entry.path,
    previousPath: entry.previousPath,
    kind: getChangeKind(entry),
    areas,
    added: (staged?.added ?? 0) + (unstaged?.added ?? 0),
    deleted: (staged?.deleted ?? 0) + (unstaged?.deleted ?? 0),
  };
}

function parseUntrackedFiles(output: string): readonly string[] {
  return output
    .split("\0")
    .filter((path) => path.length > 0)
    .map(normalizePorcelainPath);
}

export function parseUnifiedDiff(path: string, patch: string): FileDiff {
  const hunks: DiffHunk[] = [];
  let current: HunkState | null = null;
  let previousPath: string | null = null;
  let isBinary = false;

  for (const line of patch.split("\n")) {
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      isBinary = true;
    }
    if (line.startsWith("rename from ")) {
      previousPath = line.slice("rename from ".length);
    }
    if (line.startsWith("@@ ")) {
      if (current != null) {
        hunks.push(finishHunk(current));
      }
      current = parseHunkHeader(line);
      continue;
    }
    if (current == null) {
      continue;
    }
    current = appendDiffLine(current, line);
  }

  if (current != null) {
    hunks.push(finishHunk(current));
  }

  return { path, previousPath, hunks, isBinary };
}

export function parseSyntheticAddedFile(path: string, content: string): FileDiff {
  const rows: SplitDiffRow[] = content.split("\n").map((line, index) => ({
    kind: "add",
    newLine: index + 1,
    text: line,
  }));

  return {
    path,
    previousPath: null,
    hunks: [
      {
        header: "@@ -0,0 +1 @@ New file",
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: rows.length,
        rows,
      },
    ],
    isBinary: false,
  };
}

function getChangeAreas(entry: PorcelainEntry): readonly ChangeArea[] {
  if (entry.x === "?" && entry.y === "?") {
    return ["untracked"];
  }

  const areas: ChangeArea[] = [];
  if (entry.x !== " ") {
    areas.push("staged");
  }
  if (entry.y !== " ") {
    areas.push("unstaged");
  }
  return areas;
}

function getChangeKind(entry: PorcelainEntry): ChangeKind {
  if (entry.x === "?" && entry.y === "?") {
    return "untracked";
  }
  if (entry.x === "R" || entry.y === "R") {
    return "renamed";
  }
  if (entry.x === "A" || entry.y === "A") {
    return "added";
  }
  if (entry.x === "D" || entry.y === "D") {
    return "deleted";
  }
  return "modified";
}

function getNameStatusChangeKind(status: string): ChangeKind {
  const code = status[0] ?? "M";
  if (code === "R") {
    return "renamed";
  }
  if (code === "A") {
    return "added";
  }
  if (code === "D") {
    return "deleted";
  }
  return "modified";
}

function parseHunkHeader(header: string): HunkState {
  const match = HUNK_HEADER_PATTERN.exec(header);
  if (match == null) {
    return {
      header,
      oldStart: 0,
      oldLines: 0,
      oldLine: 0,
      newStart: 0,
      newLines: 0,
      newLine: 0,
      rows: [],
      pendingDeletes: [],
    };
  }
  const oldStart = parseHunkHeaderNumber(match?.[1]);
  const oldLines = parseHunkLineCount(match?.[2]);
  const newStart = parseHunkHeaderNumber(match?.[3]);
  const newLines = parseHunkLineCount(match?.[4]);
  return {
    header,
    oldStart,
    oldLines,
    oldLine: oldStart,
    newStart,
    newLines,
    newLine: newStart,
    rows: [],
    pendingDeletes: [],
  };
}

function parseHunkHeaderNumber(value: string | undefined): number {
  if (value == null) {
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseHunkLineCount(value: string | undefined): number {
  if (value == null) {
    return 1;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

function appendDiffLine(state: HunkState, line: string): HunkState {
  if (line.startsWith("\\ No newline at end of file")) {
    return state;
  }

  const marker = line[0] ?? " ";
  const text = line.slice(1);
  switch (marker) {
    case "-":
      return {
        ...state,
        oldLine: state.oldLine + 1,
        pendingDeletes: [...state.pendingDeletes, { oldLine: state.oldLine, text }],
      };
    case "+":
      return appendAddition(state, text);
    case " ":
      return {
        ...flushPendingDeletes(state),
        oldLine: state.oldLine + 1,
        newLine: state.newLine + 1,
        rows: [
          ...flushPendingDeletes(state).rows,
          {
            kind: "context",
            oldLine: state.oldLine,
            newLine: state.newLine,
            text,
          },
        ],
        pendingDeletes: [],
      };
    default:
      return state;
  }
}

function appendAddition(state: HunkState, text: string): HunkState {
  const [firstDelete, ...remainingDeletes] = state.pendingDeletes;
  if (firstDelete == null) {
    return {
      ...state,
      newLine: state.newLine + 1,
      rows: [...state.rows, { kind: "add", newLine: state.newLine, text }],
    };
  }

  return {
    ...state,
    newLine: state.newLine + 1,
    pendingDeletes: remainingDeletes,
    rows: [
      ...state.rows,
      {
        kind: "modify",
        oldLine: firstDelete.oldLine,
        newLine: state.newLine,
        oldText: firstDelete.text,
        newText: text,
      },
    ],
  };
}

function flushPendingDeletes(state: HunkState): HunkState {
  if (state.pendingDeletes.length === 0) {
    return state;
  }

  return {
    ...state,
    rows: [...state.rows, ...state.pendingDeletes.map(toDeleteRow)],
    pendingDeletes: [],
  };
}

function toDeleteRow(pending: PendingDelete): SplitDiffRow {
  return {
    kind: "delete",
    oldLine: pending.oldLine,
    text: pending.text,
  };
}

function finishHunk(state: HunkState): DiffHunk {
  const flushed = flushPendingDeletes(state);
  return {
    header: flushed.header,
    oldStart: flushed.oldStart,
    oldLines: flushed.oldLines,
    newStart: flushed.newStart,
    newLines: flushed.newLines,
    rows: flushed.rows,
  };
}
