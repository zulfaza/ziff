import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAnnotationsForAgentPrompt,
  getAnnotationAnchorKey,
  getComparisonKey,
  parseAnnotationStore,
} from "./annotations";
import type { Annotation, DiffComparison, RepoInfo } from "./shared";

const comparison: DiffComparison = { type: "branch", base: "main", head: "feature/annotations" };
const repoInfo: RepoInfo = {
  branch: "feature/annotations",
  path: "/repo/ziff",
  projectName: "ziff",
  worktree: "main",
  worktrees: [],
  branches: [],
};

test("annotation anchor key includes side line and file", () => {
  assert.notEqual(
    getAnnotationAnchorKey("src/app.tsx", 10, "old"),
    getAnnotationAnchorKey("src/app.tsx", 10, "new"),
  );
});

test("comparison key distinguishes branch endpoints", () => {
  assert.notEqual(
    getComparisonKey(comparison),
    getComparisonKey({ type: "branch", base: "main", head: "other" }),
  );
});

test("annotation store parser drops malformed entries", () => {
  const store = parseAnnotationStore({
    version: 1,
    annotations: [
      {
        id: "one",
        file: "src/app.tsx",
        lineStart: 12,
        lineEnd: 14,
        side: "new",
        kind: "review",
        body: "Handle empty diffs.",
        author: {
          name: "zul",
          avatarUrl: "https://github.com/zul.png?size=48",
        },
        comparison,
        createdAt: "2026-06-28T00:00:00.000Z",
        status: { state: "open" },
      },
      {
        id: "bad",
        file: "src/app.tsx",
        line: 0,
        side: "new",
        kind: "review",
        body: "Invalid line.",
        comparison,
        createdAt: "2026-06-28T00:00:00.000Z",
        status: { state: "open" },
      },
    ],
  });

  assert.equal(store.annotations.length, 1);
  assert.equal(store.annotations[0]?.id, "one");
  assert.equal(store.annotations[0]?.lineStart, 12);
  assert.equal(store.annotations[0]?.lineEnd, 14);
  assert.equal(store.annotations[0]?.author?.name, "zul");
});

test("annotation store parser accepts legacy single line entries", () => {
  const store = parseAnnotationStore({
    version: 1,
    annotations: [
      {
        id: "legacy",
        file: "src/app.tsx",
        line: 12,
        side: "new",
        kind: "review",
        body: "Handle empty diffs.",
        author: "You",
        comparison,
        createdAt: "2026-06-28T00:00:00.000Z",
        status: { state: "open" },
      },
    ],
  });

  assert.equal(store.annotations[0]?.lineStart, 12);
  assert.equal(store.annotations[0]?.lineEnd, 12);
  assert.equal(store.annotations[0]?.author?.name, "You");
});

test("agent prompt export groups sorted annotations by file", () => {
  const annotations: readonly Annotation[] = [
    {
      id: "two",
      file: "src/b.ts",
      lineStart: 4,
      lineEnd: 6,
      side: "old",
      kind: "agent-prompt",
      body: "Refactor this branch.",
      comparison,
      createdAt: "2026-06-28T00:00:01.000Z",
      status: { state: "open" },
    },
    {
      id: "one",
      file: "src/a.ts",
      lineStart: 8,
      lineEnd: 8,
      side: "new",
      kind: "review",
      body: "Add coverage.",
      comparison,
      createdAt: "2026-06-28T00:00:00.000Z",
      status: { state: "open" },
    },
  ];

  assert.equal(
    formatAnnotationsForAgentPrompt(annotations, comparison, repoInfo),
    `# Ziff Annotations

Repository: ziff
Path: /repo/ziff
Diff: main...feature/annotations

## src/a.ts

### Review on new line 8

Add coverage.

## src/b.ts

### Agent prompt on old lines 4-6

Refactor this branch.`,
  );
});
