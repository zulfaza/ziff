import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitFileEntry } from "../shared";
import { organizeFiles } from "./diffModel";
import type { FileTreeNode } from "./types";

test("organizeFiles compacts deep folder chains", () => {
  const groups = organizeFiles([file("apps/upsell-api/src/routes/v2/payments/teya-rpg.ts", 4, 0)], {
    fileGroupBy: "status",
    fileListView: "tree",
  });

  assert.equal(groups.length, 1);
  const group = groups[0];
  assert.ok(group != null);
  assert.deepEqual(toTreeShape(group.nodes), [
    {
      kind: "folder",
      name: "apps/upsell-api/src/routes/v2/payments",
      path: "apps/upsell-api/src/routes/v2/payments",
      children: [
        {
          kind: "file",
          name: "teya-rpg.ts",
          path: "apps/upsell-api/src/routes/v2/payments/teya-rpg.ts",
        },
      ],
    },
  ]);
});

test("organizeFiles stops folder compaction at affected file siblings", () => {
  const groups = organizeFiles(
    [
      file("apps/upsell-api/src/routes/v2/payments/teya-rpg.ts", 4, 0),
      file("apps/upsell-api/src/routes/v2/index.ts", 1, 0),
    ],
    { fileGroupBy: "status", fileListView: "tree" },
  );

  assert.equal(groups.length, 1);
  const group = groups[0];
  assert.ok(group != null);
  assert.deepEqual(toTreeShape(group.nodes), [
    {
      kind: "folder",
      name: "apps/upsell-api/src/routes/v2",
      path: "apps/upsell-api/src/routes/v2",
      children: [
        {
          kind: "folder",
          name: "payments",
          path: "apps/upsell-api/src/routes/v2/payments",
          children: [
            {
              kind: "file",
              name: "teya-rpg.ts",
              path: "apps/upsell-api/src/routes/v2/payments/teya-rpg.ts",
            },
          ],
        },
        { kind: "file", name: "index.ts", path: "apps/upsell-api/src/routes/v2/index.ts" },
      ],
    },
  ]);
});

type TreeShape =
  | {
      kind: "folder";
      name: string;
      path: string;
      children: readonly TreeShape[];
    }
  | {
      kind: "file";
      name: string;
      path: string;
    };

function toTreeShape(nodes: readonly FileTreeNode[]): readonly TreeShape[] {
  return nodes.map((node): TreeShape => {
    if (node.kind === "file") {
      return { kind: "file", name: node.name, path: node.path };
    }
    return {
      kind: "folder",
      name: node.name,
      path: node.path,
      children: toTreeShape(node.children),
    };
  });
}

function file(path: string, added: number, deleted: number): GitFileEntry {
  return {
    path,
    previousPath: null,
    kind: "modified",
    areas: ["unstaged"],
    added,
    deleted,
  };
}
