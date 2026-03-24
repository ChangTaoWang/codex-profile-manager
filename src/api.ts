import { invoke } from '@tauri-apps/api/core';

import type {
  AppSnapshot,
  CaptureCurrentInput,
  ProfileInput,
  SetCodexHomeInput,
  SwitchProfileResult,
  UpdateProfileInput,
} from '../shared/contracts';

const runtimeMissingMessage =
  '当前未检测到 Tauri 运行时，请使用 `npm run tauri:dev` 或构建后的桌面应用启动。';

function ensureTauriRuntime(): void {
  if (!('__TAURI_INTERNALS__' in window)) {
    throw new Error(runtimeMissingMessage);
  }
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  ensureTauriRuntime();
  return invoke<T>(command, args);
}

export const desktopApi = {
  loadSnapshot: () => call<AppSnapshot>('load_snapshot'),
  createProfile: (payload: ProfileInput) => call<AppSnapshot>('create_profile', { payload }),
  captureCurrentProfile: (payload: CaptureCurrentInput) =>
    call<AppSnapshot>('capture_current_profile', { payload }),
  updateProfile: (payload: UpdateProfileInput) => call<AppSnapshot>('update_profile', { payload }),
  deleteProfile: (profileId: string) => call<AppSnapshot>('delete_profile', { profileId }),
  switchProfile: (profileId: string) =>
    call<SwitchProfileResult>('switch_profile', { profileId }),
  setCodexHome: (payload: SetCodexHomeInput) => call<AppSnapshot>('set_codex_home', { payload }),
  openCodexHome: () => call<void>('open_codex_home'),
};
