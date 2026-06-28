import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compileResolvedKeybindingRule,
  mergeWithDefaultKeybindings,
  parseKeybindingShortcut,
  parseKeybindingWhenExpression,
} from "./keybindings";
import { resolveShortcutCommand } from "./keybindingsRuntime";

test("parses mod shortcuts", () => {
  const shortcut = parseKeybindingShortcut("mod+b");
  assert.ok(shortcut != null);
  assert.equal(shortcut.key, "b");
  assert.equal(shortcut.modKey, true);
});

test("parses comma shortcut", () => {
  const shortcut = parseKeybindingShortcut("mod+,");
  assert.ok(shortcut != null);
  assert.equal(shortcut.key, ",");
});

test("compiles default sidebar toggle binding", () => {
  const resolved = compileResolvedKeybindingRule({ key: "mod+b", command: "sidebar.toggle" });
  assert.ok(resolved != null);
  assert.equal(resolved.command, "sidebar.toggle");
});

test("parses when expressions", () => {
  const expression = parseKeybindingWhenExpression("settingsOpen && !headerMenuOpen");
  assert.ok(expression != null);
  assert.equal(expression.type, "and");
});

test("resolves configured commands from keyboard events", () => {
  const keybindings = mergeWithDefaultKeybindings([]);
  assert.equal(
    resolveShortcutCommand(
      {
        key: "b",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      },
      keybindings,
    ),
    "sidebar.toggle",
  );
  assert.equal(
    resolveShortcutCommand(
      {
        key: "o",
        metaKey: true,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
      },
      keybindings,
    ),
    "menu.project",
  );
});

test("ignores repeat events", () => {
  const keybindings = mergeWithDefaultKeybindings([]);
  assert.equal(
    resolveShortcutCommand(
      {
        key: "b",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        repeat: true,
      },
      keybindings,
    ),
    null,
  );
});
