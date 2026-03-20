import { contextBridge, ipcRenderer } from 'electron';

import type { CodexApi } from '../shared/contracts';

const api: CodexApi = {
  getAppState: () => ipcRenderer.invoke('codex:get-app-state'),
  createProfile: (input) => ipcRenderer.invoke('codex:create-profile', input),
  captureCurrentProfile: (input) => ipcRenderer.invoke('codex:capture-current-profile', input),
  updateProfile: (input) => ipcRenderer.invoke('codex:update-profile', input),
  deleteProfile: (id) => ipcRenderer.invoke('codex:delete-profile', id),
  switchProfile: (id) => ipcRenderer.invoke('codex:switch-profile', id),
  setCodexHome: (input) => ipcRenderer.invoke('codex:set-codex-home', input),
  openCodexHome: () => ipcRenderer.invoke('codex:open-codex-home'),
  restartCodex: () => ipcRenderer.invoke('codex:restart-codex'),
};

contextBridge.exposeInMainWorld('codexApi', api);
