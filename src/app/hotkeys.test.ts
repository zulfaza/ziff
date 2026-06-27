import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAppHotkey, type HotkeyEventLike } from "./hotkeys";

const baseEvent: HotkeyEventLike = {
  key: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
};

test("resolves Zed picker hotkeys", () => {
  assert.equal(
    resolveAppHotkey({ ...baseEvent, key: "o", metaKey: true, altKey: true }),
    "openRecent",
  );
  assert.equal(
    resolveAppHotkey({ ...baseEvent, key: "w", metaKey: true, ctrlKey: true }),
    "openWorktree",
  );
  assert.equal(
    resolveAppHotkey({ ...baseEvent, key: "b", metaKey: true, ctrlKey: true }),
    "openBranch",
  );
});

test("resolves sidebar toggle hotkey", () => {
  assert.equal(resolveAppHotkey({ ...baseEvent, key: "b", metaKey: true }), "toggleSidebar");
});

test("requires exact modifiers", () => {
  assert.equal(resolveAppHotkey({ ...baseEvent, key: "b", metaKey: true, shiftKey: true }), null);
  assert.equal(resolveAppHotkey({ ...baseEvent, key: "o", metaKey: true }), null);
  assert.equal(
    resolveAppHotkey({ ...baseEvent, key: "w", metaKey: true, ctrlKey: true, altKey: true }),
    null,
  );
});

test("ignores repeat events", () => {
  assert.equal(resolveAppHotkey({ ...baseEvent, key: "b", metaKey: true, repeat: true }), null);
});
