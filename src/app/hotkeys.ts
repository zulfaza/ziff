export type AppHotkeyAction = "openRecent" | "openWorktree" | "openBranch" | "toggleSidebar";

export type HeaderMenuHotkeyAction = "openRecent" | "openWorktree" | "openBranch";

export interface HotkeyEventLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
}

export function resolveAppHotkey(event: HotkeyEventLike): AppHotkeyAction | null {
  if (event.repeat === true) {
    return null;
  }

  if (
    matchesKey(event, "b") &&
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  ) {
    return "toggleSidebar";
  }

  if (
    matchesKey(event, "o") &&
    event.metaKey &&
    !event.ctrlKey &&
    event.altKey &&
    !event.shiftKey
  ) {
    return "openRecent";
  }

  if (
    matchesKey(event, "w") &&
    event.metaKey &&
    event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  ) {
    return "openWorktree";
  }

  if (
    matchesKey(event, "b") &&
    event.metaKey &&
    event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  ) {
    return "openBranch";
  }

  return null;
}

export function resolveHeaderHotkey(event: HotkeyEventLike): HeaderMenuHotkeyAction | null {
  if (event.repeat === true) {
    return null;
  }

  if (
    matchesKey(event, "o") &&
    event.metaKey &&
    !event.ctrlKey &&
    event.altKey &&
    !event.shiftKey
  ) {
    return "openRecent";
  }

  if (
    matchesKey(event, "w") &&
    event.metaKey &&
    event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  ) {
    return "openWorktree";
  }

  if (
    matchesKey(event, "b") &&
    event.metaKey &&
    event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  ) {
    return "openBranch";
  }

  return null;
}

function matchesKey(event: HotkeyEventLike, key: string): boolean {
  if (event.key.toLowerCase() === key) {
    return true;
  }
  return event.code === `Key${key.toUpperCase()}`;
}
