import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { app } from "electron";
import {
  DEFAULT_KEYBINDINGS,
  compileResolvedKeybindingsConfig,
  mergeWithDefaultKeybindings,
  parseKeybindingsConfig,
  type KeybindingRule,
  type ResolvedKeybindingsConfig,
} from "../src/keybindings";
import type { FileGroupBy, FileListView, UserSettings, ViewMode } from "../src/shared";

export interface WindowSize {
  height: number;
  width: number;
}

type PreferredEditor = "zed";

export interface AppSettings extends UserSettings {
  lastRepoPath: string | null;
  preferredEditor: PreferredEditor;
  windowSize: WindowSize | null;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  defaultViewMode: "split",
  fileGroupBy: "status",
  fileListView: "tree",
  restoreLastRepo: true,
};

const DEFAULT_SETTINGS: AppSettings = {
  ...DEFAULT_USER_SETTINGS,
  lastRepoPath: null,
  preferredEditor: "zed",
  windowSize: null,
};

let keybindingsWatcher: FSWatcher | null = null;
let keybindingsChangeListener: (() => void) | null = null;
let migratedFromLegacyConfig = false;

export function getConfigDir(): string {
  return join(homedir(), "config", "ziff");
}

export function getSettingsPath(): string {
  return join(getConfigDir(), "settings.json");
}

export function getKeybindingsConfigPath(): string {
  return join(getConfigDir(), "keybindings.json");
}

async function ensureConfigDir(): Promise<void> {
  await mkdir(getConfigDir(), { recursive: true });
}

async function migrateLegacyConfigFromUserData(): Promise<void> {
  if (migratedFromLegacyConfig) {
    return;
  }
  migratedFromLegacyConfig = true;

  await ensureConfigDir();
  const legacyDir = app.getPath("userData");
  const migrations: Array<{ legacyPath: string; nextPath: string }> = [
    { legacyPath: join(legacyDir, "settings.json"), nextPath: getSettingsPath() },
    { legacyPath: join(legacyDir, "keybindings.json"), nextPath: getKeybindingsConfigPath() },
  ];

  for (const { legacyPath, nextPath } of migrations) {
    try {
      await readFile(nextPath, "utf8");
      continue;
    } catch {
      // New path missing — try legacy copy below.
    }

    try {
      const legacyContents = await readFile(legacyPath, "utf8");
      await writeFile(nextPath, legacyContents, "utf8");
    } catch {
      continue;
    }
  }
}

export async function readSettings(): Promise<AppSettings> {
  await migrateLegacyConfigFromUserData();
  try {
    const raw = await readFile(getSettingsPath(), "utf8");
    return parseSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function writeSettings(settings: AppSettings): Promise<void> {
  await ensureConfigDir();
  const path = getSettingsPath();
  await writeFile(path, JSON.stringify(settings, null, 2), "utf8");
}

export function toUserSettings(settings: AppSettings): UserSettings {
  return {
    defaultViewMode: settings.defaultViewMode,
    fileGroupBy: settings.fileGroupBy,
    fileListView: settings.fileListView,
    restoreLastRepo: settings.restoreLastRepo,
  };
}

export function parseUserSettingsPatch(value: unknown): Partial<UserSettings> {
  if (typeof value !== "object" || value == null) {
    return {};
  }

  const patch: Partial<UserSettings> = {};
  if ("defaultViewMode" in value) {
    patch.defaultViewMode = parseViewMode(value.defaultViewMode);
  }
  if ("fileGroupBy" in value) {
    patch.fileGroupBy = parseFileGroupBy(value.fileGroupBy);
  }
  if ("fileListView" in value) {
    patch.fileListView = parseFileListView(value.fileListView);
  }
  if ("restoreLastRepo" in value && typeof value.restoreLastRepo === "boolean") {
    patch.restoreLastRepo = value.restoreLastRepo;
  }
  return patch;
}

function parseSettings(value: unknown): AppSettings {
  if (typeof value !== "object" || value == null) {
    return DEFAULT_SETTINGS;
  }

  const userSettings = parseUserSettings(value);
  const windowSize = "windowSize" in value ? parseWindowSize(value.windowSize) : null;
  const lastRepoPath =
    "lastRepoPath" in value &&
    typeof value.lastRepoPath === "string" &&
    value.lastRepoPath.length > 0
      ? value.lastRepoPath
      : null;
  const preferredEditor = parsePreferredEditor(
    "preferredEditor" in value ? value.preferredEditor : undefined,
  );

  return { ...userSettings, lastRepoPath, preferredEditor, windowSize };
}

function parseUserSettings(value: unknown): UserSettings {
  if (typeof value !== "object" || value == null) {
    return DEFAULT_USER_SETTINGS;
  }

  return {
    defaultViewMode: parseViewMode("defaultViewMode" in value ? value.defaultViewMode : undefined),
    fileGroupBy: parseFileGroupBy("fileGroupBy" in value ? value.fileGroupBy : undefined),
    fileListView: parseFileListView("fileListView" in value ? value.fileListView : undefined),
    restoreLastRepo:
      "restoreLastRepo" in value && typeof value.restoreLastRepo === "boolean"
        ? value.restoreLastRepo
        : DEFAULT_USER_SETTINGS.restoreLastRepo,
  };
}

function parseViewMode(value: unknown): ViewMode {
  return value === "split" || value === "stacked" ? value : DEFAULT_USER_SETTINGS.defaultViewMode;
}

function parseFileGroupBy(value: unknown): FileGroupBy {
  return value === "none" || value === "status" ? value : DEFAULT_USER_SETTINGS.fileGroupBy;
}

function parseFileListView(value: unknown): FileListView {
  return value === "list" || value === "tree" ? value : DEFAULT_USER_SETTINGS.fileListView;
}

function parsePreferredEditor(value: unknown): PreferredEditor {
  return value === "zed" ? value : DEFAULT_SETTINGS.preferredEditor;
}

function parseWindowSize(value: unknown): WindowSize | null {
  if (
    typeof value !== "object" ||
    value == null ||
    !("height" in value) ||
    !("width" in value) ||
    typeof value.height !== "number" ||
    typeof value.width !== "number"
  ) {
    return null;
  }

  return {
    height: Math.max(720, Math.round(value.height)),
    width: Math.max(1040, Math.round(value.width)),
  };
}

async function readCustomKeybindingRules(): Promise<readonly KeybindingRule[]> {
  await migrateLegacyConfigFromUserData();
  try {
    const raw = await readFile(getKeybindingsConfigPath(), "utf8");
    return parseKeybindingsConfig(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function loadResolvedKeybindings(): Promise<ResolvedKeybindingsConfig> {
  const customRules = await readCustomKeybindingRules();
  return mergeWithDefaultKeybindings(compileResolvedKeybindingsConfig(customRules));
}

async function writeKeybindingRules(rules: readonly KeybindingRule[]): Promise<void> {
  await ensureConfigDir();
  const path = getKeybindingsConfigPath();
  await writeFile(path, `${JSON.stringify(rules, null, 2)}\n`, "utf8");
}

export async function syncDefaultKeybindingsOnStartup(): Promise<void> {
  const path = getKeybindingsConfigPath();
  try {
    await readFile(path, "utf8");
  } catch {
    await writeKeybindingRules(DEFAULT_KEYBINDINGS);
    return;
  }

  const customRules = await readCustomKeybindingRules();
  const existingCommands = new Set(customRules.map((entry) => entry.command));
  const missingDefaults = DEFAULT_KEYBINDINGS.filter((rule) => !existingCommands.has(rule.command));
  if (missingDefaults.length === 0) {
    return;
  }

  await writeKeybindingRules([...customRules, ...missingDefaults]);
}

export async function resetKeybindings(): Promise<ResolvedKeybindingsConfig> {
  await writeKeybindingRules(DEFAULT_KEYBINDINGS);
  return compileResolvedKeybindingsConfig(DEFAULT_KEYBINDINGS);
}

export function watchKeybindingsConfig(onChange: () => void): void {
  keybindingsChangeListener = onChange;
  if (keybindingsWatcher != null) {
    return;
  }

  const path = getKeybindingsConfigPath();
  const directory = dirname(path);
  const fileName = basename(path);
  let debounceTimer: NodeJS.Timeout | undefined;

  void ensureConfigDir().finally(() => {
    keybindingsWatcher = watch(directory, (_event, changedPath) => {
      if (changedPath != null && changedPath !== fileName && changedPath !== path) {
        return;
      }
      if (debounceTimer != null) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        keybindingsChangeListener?.();
      }, 100);
    });
  });
}

export function stopWatchingKeybindingsConfig(): void {
  keybindingsWatcher?.close();
  keybindingsWatcher = null;
  keybindingsChangeListener = null;
}
