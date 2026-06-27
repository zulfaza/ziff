import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import {
  buildFileEntries,
  parseSyntheticAddedFile,
  parseUnifiedDiff,
} from "../src/gitDiff";
import type { BranchEntry, CommitRequest, FileDiff, RepoInfo, RepoSnapshot, WorktreeEntry } from "../src/shared";

const execFileAsync = promisify(execFile);
let mainWindow: BrowserWindow | null = null;
let repoPath: string | null = null;

interface WindowSize {
  height: number;
  width: number;
}

interface AppSettings {
  lastRepoPath: string | null;
  windowSize: WindowSize | null;
}

void app.whenReady().then(async () => {
  const settings = await readSettings();
  const iconPath = getIconPath();
  const windowSize = settings.windowSize ?? getDefaultWindowSize();

  const dock = app.dock;
  if (process.platform === "darwin" && dock != null) {
    dock.setIcon(iconPath);
  }

  mainWindow = new BrowserWindow({
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

  mainWindow.on("close", () => {
    void rememberWindowSize(mainWindow);
  });

  if (process.env.VITE_DEV_SERVER_URL != null) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, "../dist/index.html"));
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

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

ipcMain.handle("repo:choose", async (): Promise<RepoSnapshot | null> => {
  const settings = await readSettings();
  const defaultPath = repoPath ?? settings.lastRepoPath ?? undefined;
  const options: Electron.OpenDialogOptions =
    defaultPath == null
      ? { properties: ["openDirectory"] }
      : { defaultPath, properties: ["openDirectory"] };
  const result =
    mainWindow == null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options);
  const selected = result.filePaths[0];
  if (result.canceled || selected == null) {
    return null;
  }

  repoPath = await git(selected, ["rev-parse", "--show-toplevel"]);
  await rememberRepoPath(repoPath);
  return readSnapshot();
});

ipcMain.handle("repo:snapshot", async (): Promise<RepoSnapshot | null> => readSnapshot());
ipcMain.handle("repo:refresh", async (): Promise<RepoSnapshot | null> => readSnapshot());

ipcMain.handle("repo:diff", async (_event, path: unknown): Promise<FileDiff> => {
  const parsedPath = parsePath(path);
  const cwd = requireRepoPath();
  const patch = await gitAllowFailure(cwd, ["diff", "--no-ext-diff", "--", parsedPath]);
  if (patch.trim().length > 0) {
    return parseUnifiedDiff(parsedPath, patch);
  }

  const stagedPatch = await gitAllowFailure(cwd, [
    "diff",
    "--cached",
    "--no-ext-diff",
    "--",
    parsedPath,
  ]);
  if (stagedPatch.trim().length > 0) {
    return parseUnifiedDiff(parsedPath, stagedPatch);
  }

  const absolutePath = resolve(cwd, parsedPath);
  const content = await readFile(absolutePath, "utf8");
  return parseSyntheticAddedFile(parsedPath, content);
});

ipcMain.handle("repo:stage", async (_event, path: unknown): Promise<RepoSnapshot> => {
  const cwd = requireRepoPath();
  await git(cwd, ["add", "--", parsePath(path)]);
  return requireSnapshot();
});

ipcMain.handle("repo:unstage", async (_event, path: unknown): Promise<RepoSnapshot> => {
  const cwd = requireRepoPath();
  await git(cwd, ["restore", "--staged", "--", parsePath(path)]);
  return requireSnapshot();
});

ipcMain.handle("repo:stage-all", async (): Promise<RepoSnapshot> => {
  const cwd = requireRepoPath();
  await git(cwd, ["add", "--all"]);
  return requireSnapshot();
});

ipcMain.handle("repo:switch-branch", async (_event, branch: unknown): Promise<RepoSnapshot> => {
  const cwd = requireRepoPath();
  await git(cwd, ["checkout", parseName(branch)]);
  return requireSnapshot();
});

ipcMain.handle("repo:switch-worktree", async (_event, path: unknown): Promise<RepoSnapshot> => {
  const selectedPath = parsePath(path);
  repoPath = await git(selectedPath, ["rev-parse", "--show-toplevel"]);
  await rememberRepoPath(repoPath);
  return requireSnapshot();
});

ipcMain.handle("repo:commit", async (_event, request: unknown): Promise<RepoSnapshot> => {
  const cwd = requireRepoPath();
  const parsed = parseCommitRequest(request);
  await git(cwd, ["commit", "-m", parsed.message]);
  return requireSnapshot();
});

ipcMain.handle("repo:open-file", async (_event, path: unknown): Promise<void> => {
  const cwd = requireRepoPath();
  await shell.openPath(resolve(cwd, parsePath(path)));
});

async function requireSnapshot(): Promise<RepoSnapshot> {
  const snapshot = await readSnapshot();
  if (snapshot == null) {
    throw new Error("No repo selected");
  }
  return snapshot;
}

async function readSnapshot(): Promise<RepoSnapshot | null> {
  if (repoPath == null) {
    await restoreRepoPath();
  }

  const cwd = repoPath;
  if (cwd == null) {
    return null;
  }

  const [branch, root, worktreeList, branchList, status, stagedNumStat, unstagedNumStat, untrackedFiles] = await Promise.all([
    git(cwd, ["branch", "--show-current"]),
    git(cwd, ["rev-parse", "--show-toplevel"]),
    git(cwd, ["worktree", "list", "--porcelain"]),
    git(cwd, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)%09%(authorname)%09%(committerdate:relative)%09%(subject)", "refs/heads"]),
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

async function restoreRepoPath(): Promise<void> {
  const settings = await readSettings();
  if (settings.lastRepoPath == null) {
    return;
  }

  try {
    repoPath = await git(settings.lastRepoPath, ["rev-parse", "--show-toplevel"]);
  } catch {
    repoPath = null;
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
    return { lastRepoPath: null, windowSize: null };
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
  if (
    typeof value !== "object" ||
    value == null ||
    !("lastRepoPath" in value)
  ) {
    return { lastRepoPath: null, windowSize: null };
  }

  const windowSize = "windowSize" in value ? parseWindowSize(value.windowSize) : null;

  if (typeof value.lastRepoPath === "string" && value.lastRepoPath.length > 0) {
    return { lastRepoPath: value.lastRepoPath, windowSize };
  }

  return { lastRepoPath: null, windowSize };
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

function requireRepoPath(): string {
  if (repoPath == null) {
    throw new Error("No repo selected");
  }
  return repoPath;
}

function parsePath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Expected path");
  }
  return value;
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
    const branch = branchLine == null ? "HEAD" : branchLine.slice("branch ".length).replace(/^refs\/heads\//, "");
    const head = headLine == null ? "" : headLine.slice("HEAD ".length);
    return [{
      branch,
      isCurrent: path === root,
      name: path === primary ? "main" : basename(path),
      path,
      shortHead: head.slice(0, 7),
    }];
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

function isString(value: string | undefined): value is string {
  return value != null;
}

function isExecError(value: unknown): value is { stdout: unknown } {
  return typeof value === "object" && value != null && "stdout" in value;
}
