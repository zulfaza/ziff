import { contextBridge, ipcRenderer } from "electron";
import type {
  CommitRequest,
  DiffComparison,
  DiffRequest,
  FileDiff,
  ImagePreviewRequest,
  RepoSnapshot,
  SidebarSettings,
  ZiffApi,
} from "../src/shared";

const api: ZiffApi = {
  chooseRepo: () => ipcRenderer.invoke("repo:choose"),
  commit: (request: CommitRequest) => ipcRenderer.invoke("repo:commit", request),
  getAnnotations: (request) => ipcRenderer.invoke("annotations:get", request),
  getComparison: (comparison: DiffComparison) => ipcRenderer.invoke("repo:compare", comparison),
  getDiff: (request: DiffRequest) => ipcRenderer.invoke("repo:diff", request),
  getImagePreview: (request: ImagePreviewRequest) =>
    ipcRenderer.invoke("repo:image-preview", request),
  getHistory: () => ipcRenderer.invoke("repo:history"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  getSnapshot: () => ipcRenderer.invoke("repo:snapshot"),
  openFile: (path: string) => ipcRenderer.invoke("repo:open-file", path),
  openProjectWindow: (path: string) => ipcRenderer.invoke("repo:open-project-window", path),
  refresh: () => ipcRenderer.invoke("repo:refresh"),
  saveAnnotations: (request) => ipcRenderer.invoke("annotations:save", request),
  stage: (path: string) => ipcRenderer.invoke("repo:stage", path),
  stageAll: () => ipcRenderer.invoke("repo:stage-all"),
  switchBranch: (branch: string) => ipcRenderer.invoke("repo:switch-branch", branch),
  switchWorktree: (path: string) => ipcRenderer.invoke("repo:switch-worktree", path),
  unstage: (path: string) => ipcRenderer.invoke("repo:unstage", path),
  updateSettings: (settings: Partial<SidebarSettings>) =>
    ipcRenderer.invoke("settings:update", settings),
};

contextBridge.exposeInMainWorld("ziff", api);

export type { CommitRequest, FileDiff, RepoSnapshot, ZiffApi };
