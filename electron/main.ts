import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import {
  buildFileEntries,
  parseSyntheticAddedFile,
  parseUnifiedDiff,
} from "../src/gitDiff";
import type { CommitRequest, FileDiff, RepoInfo, RepoSnapshot } from "../src/shared";

const execFileAsync = promisify(execFile);
let mainWindow: BrowserWindow | null = null;
let repoPath: string | null = null;

void app.whenReady().then(async () => {
  mainWindow = new BrowserWindow({
    backgroundColor: "#11151d",
    minHeight: 720,
    minWidth: 1040,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.js"),
    },
  });

  if (process.env.VITE_DEV_SERVER_URL != null) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, "../../dist/index.html"));
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("repo:choose", async (): Promise<RepoSnapshot | null> => {
  const result =
    mainWindow == null
      ? await dialog.showOpenDialog({ properties: ["openDirectory"] })
      : await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  const selected = result.filePaths[0];
  if (result.canceled || selected == null) {
    return null;
  }

  repoPath = await git(selected, ["rev-parse", "--show-toplevel"]);
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
  const cwd = repoPath;
  if (cwd == null) {
    return null;
  }

  const [branch, root, status, stagedNumStat, unstagedNumStat] = await Promise.all([
    git(cwd, ["branch", "--show-current"]),
    git(cwd, ["rev-parse", "--show-toplevel"]),
    git(cwd, ["status", "--porcelain=v1", "-z"]),
    git(cwd, ["diff", "--cached", "--numstat"]),
    git(cwd, ["diff", "--numstat"]),
  ]);
  const info: RepoInfo = {
    branch: branch.length > 0 ? branch : "HEAD",
    path: root,
  };

  return {
    info,
    files: buildFileEntries(status, stagedNumStat, unstagedNumStat),
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

function isExecError(value: unknown): value is { stdout: unknown } {
  return typeof value === "object" && value != null && "stdout" in value;
}
