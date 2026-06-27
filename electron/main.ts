import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from "electron";
import {
  buildComparisonFileEntries,
  buildFileEntries,
  parseSyntheticAddedFile,
  parseUnifiedDiff,
} from "../src/gitDiff";
import type {
  BranchEntry,
  CommitEntry,
  CommitRequest,
  DiffComparison,
  DiffRequest,
  FileDiff,
  FileGroupBy,
  FileListView,
  GitFileEntry,
  ImagePreview,
  ImagePreviewRequest,
  ImagePreviewMimeType,
  RepoInfo,
  RepoSnapshot,
  SidebarSettings,
  WorktreeEntry,
} from "../src/shared";

const execFileAsync = promisify(execFile);
const windowStates = new Map<number, ZiffWindowState>();

const APP_NAME = "Ziff";
const maxDiffContextLines = 80;

app.setName(APP_NAME);

interface WindowSize {
  height: number;
  width: number;
}

interface ZiffWindowState {
  repoPath: string | null;
  restoreRepoOnFirstSnapshot: boolean;
}

type PreferredEditor = "zed";
type HistoricalComparison = Exclude<DiffComparison, { type: "working-tree" }>;

interface HistoricalImagePreviewRequest {
  comparison: HistoricalComparison;
  path: string;
  previousPath: string | null;
}

interface EditorDefinition {
  commands: readonly [string, ...string[]];
  macAppName: string;
}

interface AppSettings extends SidebarSettings {
  lastRepoPath: string | null;
  preferredEditor: PreferredEditor;
  windowSize: WindowSize | null;
}

const EDITOR_DEFINITIONS: Record<PreferredEditor, EditorDefinition> = {
  zed: { commands: ["zed", "zeditor"], macAppName: "Zed" },
};

const DEFAULT_SETTINGS: AppSettings = {
  fileGroupBy: "status",
  fileListView: "tree",
  lastRepoPath: null,
  preferredEditor: "zed",
  windowSize: null,
};

void app.whenReady().then(async () => {
  const iconPath = getIconPath();
  const dock = app.dock;
  if (process.platform === "darwin" && dock != null) {
    dock.setIcon(iconPath);
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenu()));
  await createWindow({ restoreLastRepo: true });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow({ restoreLastRepo: false });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

interface CreateWindowOptions {
  repoPath?: string;
  restoreLastRepo: boolean;
}

async function createWindow(options: CreateWindowOptions): Promise<BrowserWindow> {
  const settings = await readSettings();
  const iconPath = getIconPath();
  const windowSize = settings.windowSize ?? getDefaultWindowSize();

  const window = new BrowserWindow({
    backgroundColor: "#11151d",
    height: windowSize.height,
    icon: iconPath,
    minHeight: getMinWindowSize().height,
    minWidth: getMinWindowSize().width,
    titleBarStyle: "hiddenInset",
    width: windowSize.width,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.js"),
    },
  });

  const windowId = window.webContents.id;
  windowStates.set(windowId, {
    repoPath: options.repoPath ?? null,
    restoreRepoOnFirstSnapshot: options.restoreLastRepo,
  });

  window.on("close", () => {
    void rememberWindowSize(window);
  });
  window.on("closed", () => {
    windowStates.delete(windowId);
  });

  if (process.env.VITE_DEV_SERVER_URL != null) {
    await window.loadURL(getDevServerUrl(options.restoreLastRepo));
  } else {
    await window.loadFile(join(__dirname, "../dist/index.html"), {
      query: { restoreProject: options.restoreLastRepo ? "1" : "0" },
    });
  }

  return window;
}

function buildApplicationMenu(): MenuItemConstructorOptions[] {
  const fileSubmenu: MenuItemConstructorOptions[] = [
    {
      accelerator: "CmdOrCtrl+N",
      click: () => {
        void createWindow({ restoreLastRepo: false });
      },
      label: "New Window",
    },
    { type: "separator" },
    { role: process.platform === "darwin" ? "close" : "quit" },
  ];

  if (process.platform !== "darwin") {
    return [
      { label: "File", submenu: fileSubmenu },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ];
  }

  return [
    {
      label: APP_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { label: "File", submenu: fileSubmenu },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
}

function getDevServerUrl(restoreLastRepo: boolean): string {
  const rawUrl = process.env.VITE_DEV_SERVER_URL;
  if (rawUrl == null) {
    throw new Error("Missing dev server URL");
  }

  const url = new URL(rawUrl);
  url.searchParams.set("restoreProject", restoreLastRepo ? "1" : "0");
  return url.toString();
}

function getIconPath(): string {
  const packagedIcon = join(__dirname, "../dist/icon-512.png");
  if (existsSync(packagedIcon)) {
    return packagedIcon;
  }

  return join(app.getAppPath(), "public/icon-512.png");
}

function getDefaultWindowSize(): WindowSize {
  return { height: 900, width: 1440 };
}

function getMinWindowSize(): WindowSize {
  return { height: 720, width: 1040 };
}

ipcMain.handle("settings:get", async (): Promise<SidebarSettings> => {
  const settings = await readSettings();
  return {
    fileGroupBy: settings.fileGroupBy,
    fileListView: settings.fileListView,
  };
});

ipcMain.handle("settings:update", async (_event, patch: unknown): Promise<SidebarSettings> => {
  const settings = await readSettings();
  const next = { ...settings, ...parseSidebarSettingsPatch(patch) };
  await writeSettings(next);
  return {
    fileGroupBy: next.fileGroupBy,
    fileListView: next.fileListView,
  };
});

ipcMain.handle("repo:choose", async (event): Promise<RepoSnapshot | null> => {
  const state = getWindowState(event);
  const settings = await readSettings();
  const defaultPath = state.repoPath ?? settings.lastRepoPath ?? undefined;
  const options: Electron.OpenDialogOptions =
    defaultPath == null
      ? { properties: ["openDirectory"] }
      : { defaultPath, properties: ["openDirectory"] };
  const parent = BrowserWindow.fromWebContents(event.sender);
  const result =
    parent == null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(parent, options);
  const selected = result.filePaths[0];
  if (result.canceled || selected == null) {
    return null;
  }

  state.repoPath = await git(selected, ["rev-parse", "--show-toplevel"]);
  await rememberRepoPath(state.repoPath);
  return readSnapshot(state);
});

ipcMain.handle(
  "repo:snapshot",
  async (event): Promise<RepoSnapshot | null> => readSnapshot(getWindowState(event)),
);
ipcMain.handle(
  "repo:refresh",
  async (event): Promise<RepoSnapshot | null> => readSnapshot(getWindowState(event)),
);

ipcMain.handle("repo:compare", async (event, comparison: unknown): Promise<RepoSnapshot> => {
  const cwd = requireRepoPath(getWindowState(event));
  return readComparisonSnapshot(cwd, parseDiffComparison(comparison));
});

ipcMain.handle("repo:diff", async (event, request: unknown): Promise<FileDiff> => {
  const cwd = requireRepoPath(getWindowState(event));
  const parsedRequest = parseDiffRequest(request);
  const contextArg = `--unified=${parsedRequest.contextLines}`;
  if (parsedRequest.comparison.type !== "working-tree") {
    return readComparisonDiff(
      cwd,
      parsedRequest.path,
      parsedRequest.comparison,
      parsedRequest.contextLines,
    );
  }

  const parsedPath = parsedRequest.path;
  const patch = await gitAllowFailure(cwd, ["diff", "--no-ext-diff", contextArg, "--", parsedPath]);
  if (patch.trim().length > 0) {
    return parseUnifiedDiff(parsedPath, patch);
  }

  const stagedPatch = await gitAllowFailure(cwd, [
    "diff",
    "--cached",
    "--no-ext-diff",
    contextArg,
    "--",
    parsedPath,
  ]);
  if (stagedPatch.trim().length > 0) {
    return parseUnifiedDiff(parsedPath, stagedPatch);
  }

  const mimeType = getPreviewMimeType(parsedPath);
  if (mimeType != null && mimeType !== "image/svg+xml") {
    return { path: parsedPath, previousPath: null, hunks: [], isBinary: true };
  }

  const absolutePath = resolve(cwd, parsedPath);
  const content = await readFile(absolutePath, "utf8");
  return parseSyntheticAddedFile(parsedPath, content);
});

ipcMain.handle("repo:image-preview", async (event, request: unknown): Promise<ImagePreview> => {
  const parsedRequest = parseImagePreviewRequest(request);
  const cwd = requireRepoPath(getWindowState(event));
  return readImagePreview(cwd, parsedRequest);
});

ipcMain.handle("repo:history", async (event): Promise<readonly CommitEntry[]> => {
  const cwd = requireRepoPath(getWindowState(event));
  const log = await git(cwd, ["log", "--format=%H%x09%h%x09%an%x09%ae%x09%cr%x09%s", "-n", "200"]);
  return parseCommits(log);
});

ipcMain.handle("repo:stage", async (event, path: unknown): Promise<RepoSnapshot> => {
  const state = getWindowState(event);
  const cwd = requireRepoPath(state);
  await git(cwd, ["add", "--", parsePath(path)]);
  return requireSnapshot(state);
});

ipcMain.handle("repo:unstage", async (event, path: unknown): Promise<RepoSnapshot> => {
  const state = getWindowState(event);
  const cwd = requireRepoPath(state);
  await git(cwd, ["restore", "--staged", "--", parsePath(path)]);
  return requireSnapshot(state);
});

ipcMain.handle("repo:stage-all", async (event): Promise<RepoSnapshot> => {
  const state = getWindowState(event);
  const cwd = requireRepoPath(state);
  await git(cwd, ["add", "--all"]);
  return requireSnapshot(state);
});

ipcMain.handle("repo:switch-branch", async (event, branch: unknown): Promise<RepoSnapshot> => {
  const state = getWindowState(event);
  const cwd = requireRepoPath(state);
  await git(cwd, ["checkout", parseName(branch)]);
  return requireSnapshot(state);
});

ipcMain.handle("repo:switch-worktree", async (event, path: unknown): Promise<RepoSnapshot> => {
  const state = getWindowState(event);
  const selectedPath = parsePath(path);
  state.repoPath = await git(selectedPath, ["rev-parse", "--show-toplevel"]);
  await rememberRepoPath(state.repoPath);
  return requireSnapshot(state);
});

ipcMain.handle("repo:commit", async (event, request: unknown): Promise<RepoSnapshot> => {
  const state = getWindowState(event);
  const cwd = requireRepoPath(state);
  const parsed = parseCommitRequest(request);
  await git(cwd, ["commit", "-m", parsed.message]);
  return requireSnapshot(state);
});

ipcMain.handle("repo:open-file", async (event, path: unknown): Promise<void> => {
  const cwd = requireRepoPath(getWindowState(event));
  const settings = await readSettings();
  await openPathInEditor(settings.preferredEditor, resolve(cwd, parsePath(path)));
});

ipcMain.handle("repo:open-project-window", async (_event, path: unknown): Promise<void> => {
  const repoPath = await git(parsePath(path), ["rev-parse", "--show-toplevel"]);
  await rememberRepoPath(repoPath);
  await createWindow({ repoPath, restoreLastRepo: false });
});

async function requireSnapshot(state: ZiffWindowState): Promise<RepoSnapshot> {
  const snapshot = await readSnapshot(state);
  if (snapshot == null) {
    throw new Error("No repo selected");
  }
  return snapshot;
}

async function readSnapshot(state: ZiffWindowState): Promise<RepoSnapshot | null> {
  if (state.repoPath == null && state.restoreRepoOnFirstSnapshot) {
    state.restoreRepoOnFirstSnapshot = false;
    await restoreRepoPath(state);
  }

  const cwd = state.repoPath;
  if (cwd == null) {
    return null;
  }

  return readWorkingTreeSnapshot(cwd);
}

async function readWorkingTreeSnapshot(cwd: string): Promise<RepoSnapshot> {
  const [
    branch,
    root,
    worktreeList,
    branchList,
    status,
    stagedNumStat,
    unstagedNumStat,
    untrackedFiles,
  ] = await Promise.all([
    git(cwd, ["branch", "--show-current"]),
    git(cwd, ["rev-parse", "--show-toplevel"]),
    git(cwd, ["worktree", "list", "--porcelain"]),
    git(cwd, [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname:short)%09%(authorname)%09%(committerdate:relative)%09%(subject)",
      "refs/heads",
    ]),
    git(cwd, ["status", "--porcelain=v1", "-z"]),
    git(cwd, ["diff", "--cached", "--numstat"]),
    git(cwd, ["diff", "--numstat"]),
    git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const currentBranch = branch.length > 0 ? branch : "HEAD";
  const info: RepoInfo = {
    branch: currentBranch,
    path: root,
    projectName: basename(root),
    worktree: getWorktreeName(root, worktreeList),
    worktrees: parseWorktrees(root, worktreeList),
    branches: parseBranches(currentBranch, branchList),
  };

  return {
    info,
    files: buildFileEntries(status, stagedNumStat, unstagedNumStat, untrackedFiles),
  };
}

async function readComparisonSnapshot(
  cwd: string,
  comparison: DiffComparison,
): Promise<RepoSnapshot> {
  if (comparison.type === "working-tree") {
    return readWorkingTreeSnapshot(cwd);
  }

  const [info, files] = await Promise.all([
    readRepoInfo(cwd),
    readComparisonFileEntries(cwd, comparison),
  ]);
  return { info, files };
}

async function readRepoInfo(cwd: string): Promise<RepoInfo> {
  const [branch, root, worktreeList, branchList] = await Promise.all([
    git(cwd, ["branch", "--show-current"]),
    git(cwd, ["rev-parse", "--show-toplevel"]),
    git(cwd, ["worktree", "list", "--porcelain"]),
    git(cwd, [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname:short)%09%(authorname)%09%(committerdate:relative)%09%(subject)",
      "refs/heads",
    ]),
  ]);
  const currentBranch = branch.length > 0 ? branch : "HEAD";
  return {
    branch: currentBranch,
    path: root,
    projectName: basename(root),
    worktree: getWorktreeName(root, worktreeList),
    worktrees: parseWorktrees(root, worktreeList),
    branches: parseBranches(currentBranch, branchList),
  };
}

async function readComparisonFileEntries(
  cwd: string,
  comparison: HistoricalComparison,
): Promise<readonly GitFileEntry[]> {
  if (comparison.type === "branch") {
    const range = `${comparison.base}...${comparison.head}`;
    const [nameStatus, numStat] = await Promise.all([
      git(cwd, ["diff", "--name-status", "-z", "--find-renames", range]),
      git(cwd, ["diff", "--numstat", "--find-renames", range]),
    ]);
    return buildComparisonFileEntries(nameStatus, numStat);
  }

  const [nameStatus, numStat] = await Promise.all([
    git(cwd, ["show", "--format=", "--name-status", "-z", "--find-renames", comparison.hash]),
    git(cwd, ["show", "--format=", "--numstat", "--find-renames", comparison.hash]),
  ]);
  return buildComparisonFileEntries(nameStatus, numStat);
}

async function readComparisonDiff(
  cwd: string,
  path: string,
  comparison: HistoricalComparison,
  contextLines: number,
): Promise<FileDiff> {
  const contextArg = `--unified=${contextLines}`;
  const patch =
    comparison.type === "branch"
      ? await gitAllowFailure(cwd, [
          "diff",
          "--no-ext-diff",
          "--find-renames",
          contextArg,
          `${comparison.base}...${comparison.head}`,
          "--",
          path,
        ])
      : await gitAllowFailure(cwd, [
          "show",
          "--format=",
          "--no-ext-diff",
          "--find-renames",
          contextArg,
          comparison.hash,
          "--",
          path,
        ]);

  if (patch.trim().length === 0) {
    return { path, previousPath: null, hunks: [], isBinary: false };
  }
  return parseUnifiedDiff(path, patch);
}

async function openPathInEditor(editor: PreferredEditor, path: string): Promise<void> {
  const definition = EDITOR_DEFINITIONS[editor];
  for (const command of definition.commands) {
    if (await tryLaunchDetached(command, [path])) {
      return;
    }
  }

  if (process.platform === "darwin" && (await tryLaunchMacApp(definition.macAppName, path))) {
    return;
  }

  throw new Error(`Editor command not found: ${definition.commands.join(", ")}`);
}

async function tryLaunchDetached(command: string, args: readonly string[]): Promise<boolean> {
  try {
    await launchDetached(command, args);
    return true;
  } catch (error) {
    if (isMissingCommandError(error)) {
      return false;
    }
    throw error;
  }
}

function launchDetached(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolvePromise();
    });
  });
}

async function tryLaunchMacApp(appName: string, path: string): Promise<boolean> {
  try {
    await execFileAsync("open", ["-a", appName, path]);
    return true;
  } catch (error) {
    if (isMissingCommandError(error)) {
      return false;
    }
    throw error;
  }
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], {
    cwd,
    maxBuffer: 1024 * 1024 * 32,
  });
  return result.stdout.trimEnd();
}

async function gitAllowFailure(cwd: string, args: readonly string[]): Promise<string> {
  try {
    return await git(cwd, args);
  } catch (error) {
    if (isExecError(error) && typeof error.stdout === "string") {
      return error.stdout;
    }
    throw error;
  }
}

async function gitBuffer(cwd: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      [...args],
      {
        cwd,
        encoding: "buffer",
        maxBuffer: 1024 * 1024 * 32,
      },
      (error, stdout) => {
        if (error != null) {
          reject(error);
          return;
        }
        resolvePromise(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      },
    );
  });
}

async function readImagePreview(cwd: string, request: ImagePreviewRequest): Promise<ImagePreview> {
  const comparison = request.comparison;
  if (comparison.type !== "working-tree") {
    return readComparisonImagePreview(cwd, { ...request, comparison });
  }

  const path = request.path;
  const previousPath = request.previousPath;
  const afterMimeType = requirePreviewMimeType(path);
  const beforePath = previousPath ?? path;
  const beforeMimeType = getPreviewMimeType(beforePath);
  const [unstagedPatch, stagedPatch] = await Promise.all([
    gitAllowFailure(cwd, ["diff", "--no-ext-diff", "--", path]),
    gitAllowFailure(cwd, ["diff", "--cached", "--no-ext-diff", "--", path]),
  ]);

  if (unstagedPatch.trim().length > 0) {
    return {
      after: await readOptionalWorktreeImage(cwd, path, afterMimeType),
      before:
        beforeMimeType == null
          ? null
          : await readOptionalGitImage(cwd, `:${beforePath}`, beforeMimeType),
    };
  }

  if (stagedPatch.trim().length > 0) {
    return {
      after: await readOptionalGitImage(cwd, `:${path}`, afterMimeType),
      before:
        beforeMimeType == null
          ? null
          : await readOptionalGitImage(cwd, `HEAD:${beforePath}`, beforeMimeType),
    };
  }

  return {
    after: await readOptionalWorktreeImage(cwd, path, afterMimeType),
    before: null,
  };
}

async function readComparisonImagePreview(
  cwd: string,
  request: HistoricalImagePreviewRequest,
): Promise<ImagePreview> {
  const afterMimeType = requirePreviewMimeType(request.path);
  const beforePath = request.previousPath ?? request.path;
  const beforeMimeType = getPreviewMimeType(beforePath);
  const beforeRef =
    request.comparison.type === "branch"
      ? await git(cwd, ["merge-base", request.comparison.base, request.comparison.head])
      : `${request.comparison.hash}^`;
  const afterRef =
    request.comparison.type === "branch" ? request.comparison.head : request.comparison.hash;

  return {
    after: await readOptionalGitImage(cwd, `${afterRef}:${request.path}`, afterMimeType),
    before:
      beforeMimeType == null
        ? null
        : await readOptionalGitImage(cwd, `${beforeRef}:${beforePath}`, beforeMimeType),
  };
}

async function readOptionalWorktreeImage(
  cwd: string,
  path: string,
  mimeType: ImagePreviewMimeType,
): Promise<ImagePreview["after"]> {
  try {
    return toImagePreviewSide(await readFile(resolve(cwd, path)), mimeType);
  } catch {
    return null;
  }
}

async function readOptionalGitImage(
  cwd: string,
  spec: string,
  mimeType: ImagePreviewMimeType,
): Promise<ImagePreview["before"]> {
  try {
    return toImagePreviewSide(await gitBuffer(cwd, ["show", spec]), mimeType);
  } catch {
    return null;
  }
}

function toImagePreviewSide(buffer: Buffer, mimeType: ImagePreviewMimeType): ImagePreview["after"] {
  return {
    dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    mimeType,
  };
}

function requirePreviewMimeType(path: string): ImagePreviewMimeType {
  const mimeType = getPreviewMimeType(path);
  if (mimeType == null) {
    throw new Error("Unsupported image preview type");
  }
  return mimeType;
}

function getPreviewMimeType(path: string): ImagePreviewMimeType | null {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith(".avif")) {
    return "image/avif";
  }
  if (lowerPath.endsWith(".gif")) {
    return "image/gif";
  }
  if (lowerPath.endsWith(".jpeg") || lowerPath.endsWith(".jpg")) {
    return "image/jpeg";
  }
  if (lowerPath.endsWith(".png")) {
    return "image/png";
  }
  if (lowerPath.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (lowerPath.endsWith(".webp")) {
    return "image/webp";
  }
  return null;
}

async function restoreRepoPath(state: ZiffWindowState): Promise<void> {
  const settings = await readSettings();
  if (settings.lastRepoPath == null) {
    return;
  }

  try {
    state.repoPath = await git(settings.lastRepoPath, ["rev-parse", "--show-toplevel"]);
  } catch {
    state.repoPath = null;
  }
}

async function rememberRepoPath(path: string): Promise<void> {
  try {
    const settings = await readSettings();
    await writeSettings({ ...settings, lastRepoPath: path });
  } catch {
    return;
  }
}

async function rememberWindowSize(window: BrowserWindow | null): Promise<void> {
  if (window == null || window.isDestroyed()) {
    return;
  }

  const [width, height] = window.getSize();
  try {
    const settings = await readSettings();
    await writeSettings({ ...settings, windowSize: normalizeWindowSize({ height, width }) });
  } catch {
    return;
  }
}

async function readSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(getSettingsPath(), "utf8");
    return parseSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function writeSettings(settings: AppSettings): Promise<void> {
  const path = getSettingsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(settings, null, 2), "utf8");
}

function getSettingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

function parseSettings(value: unknown): AppSettings {
  if (typeof value !== "object" || value == null) {
    return DEFAULT_SETTINGS;
  }

  const windowSize = "windowSize" in value ? parseWindowSize(value.windowSize) : null;
  const sidebar = parseSidebarSettings(value);
  const lastRepoPath =
    "lastRepoPath" in value &&
    typeof value.lastRepoPath === "string" &&
    value.lastRepoPath.length > 0
      ? value.lastRepoPath
      : null;
  const preferredEditor = parsePreferredEditor(
    "preferredEditor" in value ? value.preferredEditor : undefined,
  );

  return { ...sidebar, lastRepoPath, preferredEditor, windowSize };
}

function parseSidebarSettings(value: unknown): SidebarSettings {
  if (typeof value !== "object" || value == null) {
    return {
      fileGroupBy: DEFAULT_SETTINGS.fileGroupBy,
      fileListView: DEFAULT_SETTINGS.fileListView,
    };
  }

  return {
    fileGroupBy: parseFileGroupBy("fileGroupBy" in value ? value.fileGroupBy : undefined),
    fileListView: parseFileListView("fileListView" in value ? value.fileListView : undefined),
  };
}

function parseSidebarSettingsPatch(value: unknown): Partial<SidebarSettings> {
  if (typeof value !== "object" || value == null) {
    return {};
  }

  const patch: Partial<SidebarSettings> = {};
  if ("fileGroupBy" in value) {
    patch.fileGroupBy = parseFileGroupBy(value.fileGroupBy);
  }
  if ("fileListView" in value) {
    patch.fileListView = parseFileListView(value.fileListView);
  }
  return patch;
}

function parseFileGroupBy(value: unknown): FileGroupBy {
  return value === "none" || value === "status" ? value : DEFAULT_SETTINGS.fileGroupBy;
}

function parseFileListView(value: unknown): FileListView {
  return value === "list" || value === "tree" ? value : DEFAULT_SETTINGS.fileListView;
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

  return normalizeWindowSize({ height: value.height, width: value.width });
}

function normalizeWindowSize(size: WindowSize): WindowSize {
  const min = getMinWindowSize();
  return {
    height: Math.max(min.height, Math.round(size.height)),
    width: Math.max(min.width, Math.round(size.width)),
  };
}

function getWindowState(event: IpcMainInvokeEvent): ZiffWindowState {
  const existing = windowStates.get(event.sender.id);
  if (existing != null) {
    return existing;
  }

  const window = BrowserWindow.fromWebContents(event.sender);
  if (window == null || window.isDestroyed()) {
    throw new Error("Window not found");
  }

  const next: ZiffWindowState = {
    repoPath: null,
    restoreRepoOnFirstSnapshot: false,
  };
  windowStates.set(window.webContents.id, next);
  return next;
}

function requireRepoPath(state: ZiffWindowState): string {
  if (state.repoPath == null) {
    throw new Error("No repo selected");
  }
  return state.repoPath;
}

function parsePath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Expected path");
  }
  return value;
}

function parseNullablePath(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return parsePath(value);
}

function parseDiffRequest(value: unknown): DiffRequest {
  if (
    typeof value !== "object" ||
    value == null ||
    !("path" in value) ||
    !("contextLines" in value) ||
    !("comparison" in value)
  ) {
    throw new Error("Expected diff request");
  }
  return {
    path: parsePath(value.path),
    contextLines: parseContextLines(value.contextLines),
    comparison: parseDiffComparison(value.comparison),
  };
}

function parseContextLines(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > maxDiffContextLines
  ) {
    throw new Error("Expected context lines");
  }
  return value;
}

function parseImagePreviewRequest(value: unknown): ImagePreviewRequest {
  if (
    typeof value !== "object" ||
    value == null ||
    !("path" in value) ||
    !("previousPath" in value) ||
    !("comparison" in value)
  ) {
    throw new Error("Expected image preview request");
  }
  return {
    path: parsePath(value.path),
    previousPath: parseNullablePath(value.previousPath),
    comparison: parseDiffComparison(value.comparison),
  };
}

function parseDiffComparison(value: unknown): DiffComparison {
  if (typeof value !== "object" || value == null || !("type" in value)) {
    throw new Error("Expected comparison");
  }

  if (value.type === "working-tree") {
    return { type: "working-tree" };
  }
  if (value.type === "branch" && "base" in value && "head" in value) {
    return {
      type: "branch",
      base: parseRefName(value.base),
      head: parseRefName(value.head),
    };
  }
  if (value.type === "commit" && "hash" in value) {
    return {
      type: "commit",
      hash: parseRefName(value.hash),
    };
  }

  throw new Error("Unsupported comparison");
}

function parseRefName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    throw new Error("Expected ref");
  }
  return value.trim();
}

function parseName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Expected name");
  }
  return value.trim();
}

function parseCommitRequest(value: unknown): CommitRequest {
  if (
    typeof value !== "object" ||
    value == null ||
    !("message" in value) ||
    typeof value.message !== "string" ||
    value.message.trim().length === 0
  ) {
    throw new Error("Expected commit message");
  }
  return { message: value.message.trim() };
}

function getWorktreeName(root: string, output: string): string {
  const worktrees = parseWorktrees(root, output);
  const current = worktrees.find((worktree) => worktree.isCurrent);
  if (current == null) {
    return "main";
  }
  return current.name;
}

function parseWorktrees(root: string, output: string): readonly WorktreeEntry[] {
  const blocks = output.split("\n\n").filter((block) => block.trim().length > 0);
  const paths = blocks
    .map((block) => block.split("\n").find((line) => line.startsWith("worktree ")))
    .filter(isString)
    .map((line) => line.slice("worktree ".length));
  const primary = paths[0];

  return blocks.flatMap((block): readonly WorktreeEntry[] => {
    const lines = block.split("\n");
    const pathLine = lines.find((line) => line.startsWith("worktree "));
    if (pathLine == null) {
      return [];
    }
    const path = pathLine.slice("worktree ".length);
    const headLine = lines.find((line) => line.startsWith("HEAD "));
    const branchLine = lines.find((line) => line.startsWith("branch "));
    const branch =
      branchLine == null
        ? "HEAD"
        : branchLine.slice("branch ".length).replace(/^refs\/heads\//, "");
    const head = headLine == null ? "" : headLine.slice("HEAD ".length);
    return [
      {
        branch,
        isCurrent: path === root,
        name: path === primary ? "main" : basename(path),
        path,
        shortHead: head.slice(0, 7),
      },
    ];
  });
}

function parseBranches(currentBranch: string, output: string): readonly BranchEntry[] {
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line): BranchEntry => {
      const fields = line.split("\t");
      const name = fields[0] ?? "";
      const author = fields[1] ?? "";
      const relativeTime = fields[2] ?? "";
      const subject = fields.slice(3).join("\t");
      return {
        author,
        isCurrent: name === currentBranch,
        name,
        relativeTime,
        subject,
      };
    });
}

function parseCommits(output: string): readonly CommitEntry[] {
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line): CommitEntry => {
      const fields = line.split("\t");
      return {
        hash: fields[0] ?? "",
        shortHash: fields[1] ?? "",
        author: fields[2] ?? "",
        email: fields[3] ?? "",
        relativeTime: fields[4] ?? "",
        subject: fields.slice(5).join("\t"),
      };
    });
}

function isString(value: string | undefined): value is string {
  return value != null;
}

function isExecError(value: unknown): value is { stdout: unknown } {
  return typeof value === "object" && value != null && "stdout" in value;
}

function isMissingCommandError(value: unknown): boolean {
  return typeof value === "object" && value != null && "code" in value && value.code === "ENOENT";
}
