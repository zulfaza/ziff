import { contextBridge, ipcRenderer } from "electron";
import type { CommitRequest, FileDiff, RepoSnapshot, ZiffApi } from "../src/shared";

const api: ZiffApi = {
  chooseRepo: () => ipcRenderer.invoke("repo:choose"),
  commit: (request: CommitRequest) => ipcRenderer.invoke("repo:commit", request),
  getDiff: (path: string) => ipcRenderer.invoke("repo:diff", path),
  getSnapshot: () => ipcRenderer.invoke("repo:snapshot"),
  openFile: (path: string) => ipcRenderer.invoke("repo:open-file", path),
  refresh: () => ipcRenderer.invoke("repo:refresh"),
  stage: (path: string) => ipcRenderer.invoke("repo:stage", path),
  stageAll: () => ipcRenderer.invoke("repo:stage-all"),
  unstage: (path: string) => ipcRenderer.invoke("repo:unstage", path),
};

contextBridge.exposeInMainWorld("ziff", api);

export type { CommitRequest, FileDiff, RepoSnapshot, ZiffApi };
