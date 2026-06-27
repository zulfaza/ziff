import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildComparisonFileEntries,
  buildFileEntries,
  parseNameStatus,
  parseUnifiedDiff,
} from "./gitDiff";

test("buildFileEntries models staged, unstaged, and untracked areas", () => {
  const entries = buildFileEntries(
    "M  staged.ts\0 M unstaged.ts\0?? new.ts\0?? .zed/\0",
    "3\t1\tstaged.ts\n",
    "5\t2\tunstaged.ts\n",
  );

  assert.deepEqual(entries, [
    {
      path: "staged.ts",
      previousPath: null,
      kind: "modified",
      areas: ["staged"],
      added: 3,
      deleted: 1,
    },
    {
      path: "unstaged.ts",
      previousPath: null,
      kind: "modified",
      areas: ["unstaged"],
      added: 5,
      deleted: 2,
    },
    {
      path: "new.ts",
      previousPath: null,
      kind: "untracked",
      areas: ["untracked"],
      added: 0,
      deleted: 0,
    },
    {
      path: ".zed",
      previousPath: null,
      kind: "untracked",
      areas: ["untracked"],
      added: 0,
      deleted: 0,
    },
  ]);
});

test("buildFileEntries expands untracked directories", () => {
  const entries = buildFileEntries("?? .zed/\0", "", "", ".zed/settings.json\0.zed/tasks.json\0");

  assert.deepEqual(entries, [
    {
      path: ".zed/settings.json",
      previousPath: null,
      kind: "untracked",
      areas: ["untracked"],
      added: 0,
      deleted: 0,
    },
    {
      path: ".zed/tasks.json",
      previousPath: null,
      kind: "untracked",
      areas: ["untracked"],
      added: 0,
      deleted: 0,
    },
  ]);
});

test("parseNameStatus reads renamed diff records", () => {
  const entries = parseNameStatus("M\0src/app.ts\0R100\0old.ts\0new.ts\0");

  assert.deepEqual(entries, [
    { path: "src/app.ts", previousPath: null, status: "M" },
    { path: "new.ts", previousPath: "old.ts", status: "R100" },
  ]);
});

test("buildComparisonFileEntries models branch and commit file lists", () => {
  const entries = buildComparisonFileEntries(
    "A\0added.ts\0D\0deleted.ts\0R100\0before.ts\0after.ts\0",
    "3\t0\tadded.ts\n0\t2\tdeleted.ts\n",
  );

  assert.deepEqual(entries, [
    {
      path: "added.ts",
      previousPath: null,
      kind: "added",
      areas: ["comparison"],
      added: 3,
      deleted: 0,
    },
    {
      path: "deleted.ts",
      previousPath: null,
      kind: "deleted",
      areas: ["comparison"],
      added: 0,
      deleted: 2,
    },
    {
      path: "after.ts",
      previousPath: "before.ts",
      kind: "renamed",
      areas: ["comparison"],
      added: 0,
      deleted: 0,
    },
  ]);
});

test("parseUnifiedDiff pairs adjacent deletions and additions", () => {
  const diff = parseUnifiedDiff(
    "src/app.ts",
    [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,3 @@",
      " const a = 1",
      "-const b = 2",
      "+const b = 3",
      " const c = 4",
    ].join("\n"),
  );

  assert.equal(diff.hunks.length, 1);
  assert.deepEqual(diff.hunks[0], {
    header: "@@ -1,3 +1,3 @@",
    oldStart: 1,
    oldLines: 3,
    newStart: 1,
    newLines: 3,
    rows: [
      { kind: "context", oldLine: 1, newLine: 1, text: "const a = 1" },
      {
        kind: "modify",
        oldLine: 2,
        newLine: 2,
        oldText: "const b = 2",
        newText: "const b = 3",
      },
      { kind: "context", oldLine: 3, newLine: 3, text: "const c = 4" },
    ],
  });
});

test("parseUnifiedDiff reads hunk line ranges", () => {
  const diff = parseUnifiedDiff(
    "src/app.ts",
    [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -5 +7,0 @@",
      "-const removed = true",
      "@@ -20,2 +21,3 @@",
      " const a = 1",
      "+const b = 2",
      " const c = 3",
    ].join("\n"),
  );

  assert.deepEqual(
    diff.hunks.map((hunk) => ({
      header: hunk.header,
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
    })),
    [
      { header: "@@ -5 +7,0 @@", oldStart: 5, oldLines: 1, newStart: 7, newLines: 0 },
      { header: "@@ -20,2 +21,3 @@", oldStart: 20, oldLines: 2, newStart: 21, newLines: 3 },
    ],
  );
});

test("parseUnifiedDiff pairs adjacent deletions and additions rows", () => {
  const diff = parseUnifiedDiff(
    "src/app.ts",
    [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,3 @@",
      " const a = 1",
      "-const b = 2",
      "+const b = 3",
      " const c = 4",
    ].join("\n"),
  );

  assert.deepEqual(diff.hunks[0]?.rows, [
    { kind: "context", oldLine: 1, newLine: 1, text: "const a = 1" },
    {
      kind: "modify",
      oldLine: 2,
      newLine: 2,
      oldText: "const b = 2",
      newText: "const b = 3",
    },
    { kind: "context", oldLine: 3, newLine: 3, text: "const c = 4" },
  ]);
});
