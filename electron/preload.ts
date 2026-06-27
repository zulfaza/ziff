import { contextBridge, ipcRenderer } from "electron";
import type {
  CommitRequest,
  DiffComparison,
  DiffRequest,
  FileDiff,
  ImagePreviewRequest,
  RepoSnapshot,
  UserSettings,
  ZiffApi,
} from "../src/shared";

const api: ZiffApi = {
  chooseRepo: () => ipcRenderer.invoke("repo:choose"),
  commit: (request: CommitRequest) => ipcRenderer.invoke("repo:commit", request),
  getComparison: (comparison: DiffComparison) => ipcRenderer.invoke("repo:compare", comparison),
  getDiff: (request: DiffRequest) => ipcRenderer.invoke("repo:diff", request),
  getImagePreview: (request: ImagePreviewRequest) =>
    ipcRenderer.invoke("repo:image-preview", request),
  getHistory: () => ipcRenderer.invoke("repo:history"),
  getKeybindings: () => ipcRenderer.invoke("keybindings:get"),
  getKeybindingsConfigPath: () => ipcRenderer.invoke("keybindings:path"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  getSnapshot: () => ipcRenderer.invoke("repo:snapshot"),
  onKeybindingsChanged(listener) {
    const handler = () => listener();
    ipcRenderer.on("keybindings:changed", handler);
    return () => {
      ipcRenderer.removeListener("keybindings:changed", handler);
    };
  },
  onOpenSettings(listener) {
    const handler = () => listener();
    ipcRenderer.on("app:open-settings", handler);
    return () => {
      ipcRenderer.removeListener("app:open-settings", handler);
    };
  },
  openFile: (path: string) => ipcRenderer.invoke("repo:open-file", path),
  openKeybindingsConfig: () => ipcRenderer.invoke("keybindings:open"),
  openProjectWindow: (path: string) => ipcRenderer.invoke("repo:open-project-window", path),
  refresh: () => ipcRenderer.invoke("repo:refresh"),
  resetKeybindings: () => ipcRenderer.invoke("keybindings:reset"),
  resetSettings: () => ipcRenderer.invoke("settings:reset"),
  stage: (path: string) => ipcRenderer.invoke("repo:stage", path),
  stageAll: () => ipcRenderer.invoke("repo:stage-all"),
  switchBranch: (branch: string) => ipcRenderer.invoke("repo:switch-branch", branch),
  switchWorktree: (path: string) => ipcRenderer.invoke("repo:switch-worktree", path),
  unstage: (path: string) => ipcRenderer.invoke("repo:unstage", path),
  updateSettings: (settings: Partial<UserSettings>) => ipcRenderer.invoke("settings:update", settings),
};

contextBridge.exposeInMainWorld("ziff", api);

export type { CommitRequest, FileDiff, RepoSnapshot, ZiffApi };
