import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  comparisonKey,
  createAnnotation,
  exportAgentPrompt,
  exportReviewMarkdown,
  filterAnnotations,
  parseAnnotationStore,
} from "./annotations";

describe("comparisonKey", () => {
  test("maps comparison modes to stable keys", () => {
    assert.equal(comparisonKey({ type: "working-tree" }), "working-tree");
    assert.equal(
      comparisonKey({ type: "branch", base: "main", head: "feature" }),
      "branch:main...feature",
    );
    assert.equal(comparisonKey({ type: "commit", hash: "abc123" }), "commit:abc123");
  });
});

describe("exportReviewMarkdown", () => {
  test("groups notes by file with diff context", () => {
    const annotations = [
      createAnnotation({
        filePath: "src/a.ts",
        side: "new",
        lineStart: 4,
        lineEnd: 4,
        kind: "review",
        body: "Check null handling",
      }),
      createAnnotation({
        filePath: "src/b.ts",
        side: "old",
        lineStart: 10,
        lineEnd: 12,
        kind: "agent",
        body: "Refactor this block",
      }),
    ];

    const markdown = exportReviewMarkdown(annotations, {
      type: "branch",
      base: "main",
      head: "feature",
    });

    assert.match(markdown, /Branch diff `main` → `feature`/);
    assert.match(markdown, /## src\/a.ts/);
    assert.match(markdown, /Check null handling/);
    assert.match(markdown, /Refactor this block/);
  });
});

describe("exportAgentPrompt", () => {
  test("includes only agent prompts", () => {
    const annotations = [
      createAnnotation({
        filePath: "src/a.ts",
        side: "new",
        lineStart: 1,
        lineEnd: 1,
        kind: "review",
        body: "Nit",
      }),
      createAnnotation({
        filePath: "src/a.ts",
        side: "new",
        lineStart: 2,
        lineEnd: 2,
        kind: "agent",
        body: "Extract helper",
      }),
    ];

    const prompt = exportAgentPrompt(annotations, { type: "working-tree" });
    assert.match(prompt, /Extract helper/);
    assert.doesNotMatch(prompt, /Nit/);
  });
});

describe("filterAnnotations", () => {
  test("hides resolved annotations by default", () => {
    const annotation = createAnnotation({
      filePath: "src/a.ts",
      side: "new",
      lineStart: 1,
      lineEnd: 1,
      kind: "review",
      body: "Done",
    });
    const resolved = { ...annotation, resolved: true };
    const visible = filterAnnotations([annotation, resolved], { includeResolved: false });
    assert.equal(visible.length, 1);
    assert.equal(visible[0]?.body, "Done");
  });
});

describe("parseAnnotationStore", () => {
  test("reads persisted sessions", () => {
    const store = parseAnnotationStore({
      version: 1,
      sessions: {
        "working-tree": {
          version: 1,
          comparison: { type: "working-tree" },
          annotations: [
            {
              id: "1",
              filePath: "src/a.ts",
              side: "new",
              lineStart: 1,
              lineEnd: 1,
              kind: "review",
              body: "hello",
              createdAt: 1,
            },
          ],
        },
      },
    });

    assert.equal(store.sessions["working-tree"]?.annotations.length, 1);
    assert.equal(store.sessions["working-tree"]?.annotations[0]?.body, "hello");
  });
});
