import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFileEntries, parseUnifiedDiff } from "./gitDiff";

test("buildFileEntries models staged, unstaged, and untracked areas", () => {
  const entries = buildFileEntries(
    "M  staged.ts\0 M unstaged.ts\0?? new.ts\0?? .zed/\0",
    "3\t1\tstaged.ts\n",
    "5\t2\tunstaged.ts\n"
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
  const entries = buildFileEntries(
    "?? .zed/\0",
    "",
    "",
    ".zed/settings.json\0.zed/tasks.json\0"
  );

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
    ].join("\n")
  );

  assert.equal(diff.hunks.length, 1);
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
