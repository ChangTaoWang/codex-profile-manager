import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

import { CodexProfileService } from './codex-service';

let mainWindow: BrowserWindow | null = null;
let service: CodexProfileService | null = null;

function getService(): CodexProfileService {
  if (!service) {
    throw new Error('Codex 配置服务尚未初始化。');
  }

  return service;
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#f4efe8',
    title: 'Codex Profile Manager',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('codex:get-app-state', () => getService().getSnapshot());
  ipcMain.handle('codex:create-profile', (_event, input) => getService().createProfile(input));
  ipcMain.handle('codex:capture-current-profile', (_event, input) =>
    getService().captureCurrentProfile(input),
  );
  ipcMain.handle('codex:update-profile', (_event, input) => getService().updateProfile(input));
  ipcMain.handle('codex:delete-profile', (_event, id) => getService().deleteProfile(id));
  ipcMain.handle('codex:switch-profile', (_event, id) => getService().switchProfile(id));
  ipcMain.handle('codex:set-codex-home', (_event, input) => getService().setCodexHome(input));
  ipcMain.handle('codex:open-codex-home', () => getService().openCodexHome());
  ipcMain.handle('codex:restart-codex', () => getService().restartCodex());
}

app.whenReady().then(() => {
  service = new CodexProfileService(app.getPath('userData'));
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
