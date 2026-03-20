import { shell } from 'electron';
import TOML from '@iarna/toml';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type {
  AppSettings,
  AppSnapshot,
  CaptureCurrentInput,
  CurrentConfigState,
  ProfileRecord,
  ProfileSummary,
  RecognitionResult,
  SaveProfileInput,
  SetCodexHomeInput,
  SwitchProfileResult,
  UpdateProfileInput,
} from '../shared/contracts';

type UnknownRecord = Record<string, unknown>;

interface PersistedProfiles {
  profiles: ProfileRecord[];
}

interface PersistedSettings {
  codexHomeOverride?: string;
}

export class CodexProfileService {
  private readonly profilesPath: string;
  private readonly settingsPath: string;
  private readonly backupsDir: string;

  constructor(private readonly userDataDir: string) {
    this.profilesPath = path.join(userDataDir, 'profiles.json');
    this.settingsPath = path.join(userDataDir, 'settings.json');
    this.backupsDir = path.join(userDataDir, 'backups');
  }

  async getSnapshot(): Promise<AppSnapshot> {
    await this.ensureStorage();

    const [profiles, persistedSettings] = await Promise.all([
      this.readProfiles(),
      this.readSettings(),
    ]);

    const codexHome = this.resolveCodexHome(persistedSettings);
    const current = await this.readCurrentConfig(codexHome, profiles);

    return {
      profiles: profiles.sort(sortProfiles),
      current,
      settings: this.buildSettings(codexHome),
    };
  }

  async createProfile(input: SaveProfileInput): Promise<AppSnapshot> {
    await this.ensureStorage();

    const profiles = await this.readProfiles();
    const record = this.buildProfileRecord(input);

    profiles.push(record);
    await this.writeProfiles(profiles);

    return this.getSnapshot();
  }

  async captureCurrentProfile(input: CaptureCurrentInput): Promise<AppSnapshot> {
    await this.ensureStorage();

    const codexHome = await this.getCodexHome();
    const current = await this.readCurrentConfig(codexHome, await this.readProfiles());

    if (!current.authContent || !current.configContent) {
      throw new Error('当前 Codex 配置不完整，无法保存为新的 profile。');
    }

    return this.createProfile({
      name: input.name,
      note: input.note,
      tags: input.tags,
      authContent: current.authContent,
      configContent: current.configContent,
      source: 'captured',
    });
  }

  async updateProfile(input: UpdateProfileInput): Promise<AppSnapshot> {
    await this.ensureStorage();

    const profiles = await this.readProfiles();
    const index = profiles.findIndex((item) => item.id === input.id);

    if (index === -1) {
      throw new Error('找不到要更新的 profile。');
    }

    const existing = profiles[index];
    const nextRecord: ProfileRecord = {
      ...existing,
      name: sanitizeName(input.name),
      note: input.note?.trim() ?? '',
      tags: normalizeTags(input.tags),
      source: input.source,
      updatedAt: new Date().toISOString(),
      authContent: normalizeText(input.authContent),
      configContent: normalizeText(input.configContent),
      fingerprint: this.computeFingerprint(input.authContent, input.configContent),
      summary: buildProfileSummary(input.authContent, input.configContent),
    };

    profiles[index] = nextRecord;
    await this.writeProfiles(profiles);

    return this.getSnapshot();
  }

  async deleteProfile(id: string): Promise<AppSnapshot> {
    await this.ensureStorage();

    const profiles = await this.readProfiles();
    const nextProfiles = profiles.filter((item) => item.id !== id);

    if (nextProfiles.length === profiles.length) {
      throw new Error('找不到要删除的 profile。');
    }

    await this.writeProfiles(nextProfiles);
    return this.getSnapshot();
  }

  async switchProfile(id: string): Promise<SwitchProfileResult> {
    await this.ensureStorage();

    const profiles = await this.readProfiles();
    const profile = profiles.find((item) => item.id === id);

    if (!profile) {
      throw new Error('找不到要切换的 profile。');
    }

    const codexHome = await this.getCodexHome();
    await fs.mkdir(codexHome, { recursive: true });
    const backupDir = await this.backupCurrentConfig(codexHome);

    await Promise.all([
      fs.writeFile(path.join(codexHome, 'auth.json'), normalizeText(profile.authContent), 'utf8'),
      fs.writeFile(path.join(codexHome, 'config.toml'), normalizeText(profile.configContent), 'utf8'),
    ]);

    const switchedAt = new Date().toISOString();
    const updatedProfile = {
      ...profile,
      lastUsedAt: switchedAt,
      updatedAt: switchedAt,
    };

    const nextProfiles = profiles.map((item) => (item.id === id ? updatedProfile : item));
    await this.writeProfiles(nextProfiles);

    const current = await this.readCurrentConfig(codexHome, nextProfiles);

    return {
      switchedAt,
      backupDir,
      profile: updatedProfile,
      current,
    };
  }

  async setCodexHome(input: SetCodexHomeInput): Promise<AppSnapshot> {
    await this.ensureStorage();

    const nextSettings: PersistedSettings = {};
    const rawPath = input.path?.trim();

    if (rawPath) {
      nextSettings.codexHomeOverride = path.resolve(rawPath);
    }

    await this.writeJson(this.settingsPath, nextSettings);
    return this.getSnapshot();
  }

  async openCodexHome(): Promise<void> {
    const codexHome = await this.getCodexHome();
    await fs.mkdir(codexHome, { recursive: true });
    const error = await shell.openPath(codexHome);

    if (error) {
      throw new Error(error);
    }
  }

  async restartCodex(): Promise<void> {
    if (process.platform === 'win32') {
      await restartCodexOnWindows();
      return;
    }

    if (process.platform === 'darwin') {
      await restartCodexOnMac();
      return;
    }

    throw new Error('当前仅实现了 Windows / macOS 的 Codex 重启支持。');
  }

  private async ensureStorage(): Promise<void> {
    await fs.mkdir(this.userDataDir, { recursive: true });
    await fs.mkdir(this.backupsDir, { recursive: true });

    if (!(await exists(this.profilesPath))) {
      await this.writeJson(this.profilesPath, { profiles: [] } satisfies PersistedProfiles);
    }

    if (!(await exists(this.settingsPath))) {
      await this.writeJson(this.settingsPath, {} satisfies PersistedSettings);
    }
  }

  private buildSettings(codexHome: string): AppSettings {
    return {
      codexHome,
      defaultCodexHome: getDefaultCodexHome(),
      profilesPath: this.profilesPath,
      settingsPath: this.settingsPath,
      backupsDir: this.backupsDir,
    };
  }

  private async getCodexHome(): Promise<string> {
    const settings = await this.readSettings();
    return this.resolveCodexHome(settings);
  }

  private resolveCodexHome(settings: PersistedSettings): string {
    return settings.codexHomeOverride?.trim() || getDefaultCodexHome();
  }

  private async readProfiles(): Promise<ProfileRecord[]> {
    const raw = await this.readJson<PersistedProfiles>(this.profilesPath, { profiles: [] });
    return Array.isArray(raw.profiles) ? raw.profiles : [];
  }

  private async writeProfiles(profiles: ProfileRecord[]): Promise<void> {
    await this.writeJson(this.profilesPath, {
      profiles: profiles.sort(sortProfiles),
    } satisfies PersistedProfiles);
  }

  private async readSettings(): Promise<PersistedSettings> {
    return this.readJson<PersistedSettings>(this.settingsPath, {});
  }

  private async readCurrentConfig(
    codexHome: string,
    profiles: ProfileRecord[],
  ): Promise<CurrentConfigState> {
    const authPath = path.join(codexHome, 'auth.json');
    const configPath = path.join(codexHome, 'config.toml');
    const authExists = await exists(authPath);
    const configExists = await exists(configPath);

    if (!authExists || !configExists) {
      return {
        codexHome,
        authPath,
        configPath,
        authExists,
        configExists,
        recognition: {
          status: 'missing',
          confidence: 0,
          reason: '默认配置文件不完整，至少缺少 auth.json 或 config.toml。',
        },
      };
    }

    const [authContent, configContent] = await Promise.all([
      fs.readFile(authPath, 'utf8'),
      fs.readFile(configPath, 'utf8'),
    ]);
    const [authStat, configStat] = await Promise.all([fs.stat(authPath), fs.stat(configPath)]);

    const summary = buildProfileSummary(authContent, configContent);
    const fingerprint = this.computeFingerprint(authContent, configContent);
    const recognition = recognizeCurrentProfile(summary, fingerprint, profiles);
    const updatedAt =
      authStat.mtimeMs >= configStat.mtimeMs ? authStat.mtime.toISOString() : configStat.mtime.toISOString();

    return {
      codexHome,
      authPath,
      configPath,
      authExists,
      configExists,
      updatedAt,
      authContent,
      configContent,
      summary,
      fingerprint,
      recognition,
    };
  }

  private buildProfileRecord(input: SaveProfileInput): ProfileRecord {
    const authContent = normalizeText(input.authContent);
    const configContent = normalizeText(input.configContent);

    return {
      id: crypto.randomUUID(),
      name: sanitizeName(input.name),
      note: input.note?.trim() ?? '',
      tags: normalizeTags(input.tags),
      source: input.source,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fingerprint: this.computeFingerprint(authContent, configContent),
      authContent,
      configContent,
      summary: buildProfileSummary(authContent, configContent),
    };
  }

  private computeFingerprint(authContent: string, configContent: string): string {
    return crypto
      .createHash('sha256')
      .update(normalizeText(authContent))
      .update('\n---codex-profile-divider---\n')
      .update(normalizeText(configContent))
      .digest('hex');
  }

  private async backupCurrentConfig(codexHome: string): Promise<string> {
    const authPath = path.join(codexHome, 'auth.json');
    const configPath = path.join(codexHome, 'config.toml');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(this.backupsDir, `switch-${timestamp}`);

    await fs.mkdir(backupDir, { recursive: true });

    if (await exists(authPath)) {
      await fs.copyFile(authPath, path.join(backupDir, 'auth.json'));
    }

    if (await exists(configPath)) {
      await fs.copyFile(configPath, path.join(backupDir, 'config.toml'));
    }

    await this.writeJson(path.join(backupDir, 'meta.json'), {
      codexHome,
      createdAt: new Date().toISOString(),
    });

    return backupDir;
  }

  private async readJson<T>(filePath: string, fallback: T): Promise<T> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private async writeJson(filePath: string, value: unknown): Promise<void> {
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
}

const execFileAsync = promisify(execFile);

export function buildProfileSummary(authContent: string, configContent: string): ProfileSummary {
  const auth = parseJsonObject(authContent, 'auth.json 不是合法的 JSON。');
  const config = parseTomlObject(configContent, 'config.toml 不是合法的 TOML。');

  const accessPayload = decodeJwtPayload(getString(getObject(auth, 'tokens')?.access_token));
  const idPayload = decodeJwtPayload(getString(getObject(auth, 'tokens')?.id_token));
  const accessAuth = getObject(accessPayload, 'https://api.openai.com/auth');
  const accessProfile = getObject(accessPayload, 'https://api.openai.com/profile');
  const idAuth = getObject(idPayload, 'https://api.openai.com/auth');

  const organizations = uniqueStrings([
    ...extractOrganizationTitles(accessAuth),
    ...extractOrganizationTitles(idAuth),
  ]);

  const endpoint =
    getString(config.api_base_url) ??
    getString(config.base_url) ??
    getString(config.chatgpt_base_url) ??
    getString(config.api_url);

  const windowsConfig = getObject(config, 'windows');

  return {
    authMode: getString(auth.auth_mode) ?? 'unknown',
    email:
      getString(accessProfile?.email) ??
      getString(idPayload?.email) ??
      getString(auth.email),
    accountId:
      getString(getObject(auth, 'tokens')?.account_id) ??
      getString(accessAuth?.chatgpt_account_id) ??
      getString(idAuth?.chatgpt_account_id),
    planType:
      getString(accessAuth?.chatgpt_plan_type) ??
      getString(idAuth?.chatgpt_plan_type),
    organizations,
    model: getString(config.model),
    reasoningEffort: getString(config.model_reasoning_effort),
    sandboxMode: getString(windowsConfig?.sandbox) ?? getString(config.sandbox),
    endpoint,
    hasApiKey: Boolean(auth.OPENAI_API_KEY),
  };
}

function parseJsonObject(content: string, errorMessage: string): UnknownRecord {
  try {
    const parsed = JSON.parse(content) as unknown;

    if (!isRecord(parsed)) {
      throw new Error(errorMessage);
    }

    return parsed;
  } catch {
    throw new Error(errorMessage);
  }
}

function parseTomlObject(content: string, errorMessage: string): UnknownRecord {
  try {
    const parsed = TOML.parse(content) as unknown;

    if (!isRecord(parsed)) {
      throw new Error(errorMessage);
    }

    return parsed;
  } catch {
    throw new Error(errorMessage);
  }
}

function decodeJwtPayload(token?: string): UnknownRecord | undefined {
  if (!token) {
    return undefined;
  }

  const parts = token.split('.');
  if (parts.length < 2) {
    return undefined;
  }

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${base64}${'='.repeat((4 - (base64.length % 4 || 4)) % 4)}`;
    const payload = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(payload) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function extractOrganizationTitles(payload?: UnknownRecord): string[] {
  const organizations = payload?.organizations;
  if (!Array.isArray(organizations)) {
    return [];
  }

  return organizations
    .map((item) => (isRecord(item) ? getString(item.title) : undefined))
    .filter((item): item is string => Boolean(item));
}

function recognizeCurrentProfile(
  currentSummary: ProfileSummary,
  fingerprint: string,
  profiles: ProfileRecord[],
): RecognitionResult {
  const exact = profiles.find((item) => item.fingerprint === fingerprint);
  if (exact) {
    return {
      status: 'exact',
      matchedProfileId: exact.id,
      matchedProfileName: exact.name,
      confidence: 1,
      reason: `当前配置与已保存的 profile “${exact.name}” 完全一致。`,
    };
  }

  let bestMatch: ProfileRecord | undefined;
  let bestScore = 0;
  let bestReasons: string[] = [];

  for (const profile of profiles) {
    let score = 0;
    const reasons: string[] = [];

    if (currentSummary.accountId && currentSummary.accountId === profile.summary.accountId) {
      score += 0.42;
      reasons.push('账号 ID 相同');
    }

    if (currentSummary.email && currentSummary.email === profile.summary.email) {
      score += 0.28;
      reasons.push('邮箱一致');
    }

    if (currentSummary.authMode && currentSummary.authMode === profile.summary.authMode) {
      score += 0.1;
      reasons.push('认证模式一致');
    }

    if (currentSummary.model && currentSummary.model === profile.summary.model) {
      score += 0.12;
      reasons.push('模型相同');
    }

    if (
      currentSummary.reasoningEffort &&
      currentSummary.reasoningEffort === profile.summary.reasoningEffort
    ) {
      score += 0.05;
      reasons.push('推理强度相同');
    }

    const orgOverlap = currentSummary.organizations.filter((org) =>
      profile.summary.organizations.includes(org),
    );

    if (orgOverlap.length > 0) {
      score += 0.08;
      reasons.push(`组织信息重合 (${orgOverlap.join(' / ')})`);
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = profile;
      bestReasons = reasons;
    }
  }

  if (bestMatch && bestScore >= 0.45) {
    return {
      status: 'likely',
      matchedProfileId: bestMatch.id,
      matchedProfileName: bestMatch.name,
      confidence: Number(bestScore.toFixed(2)),
      reason: `当前配置高度接近 “${bestMatch.name}”：${bestReasons.join('，')}。`,
    };
  }

  return {
    status: 'unknown',
    confidence: 0,
    reason: '当前配置未与任何已保存 profile 完全匹配，可将当前状态另存为新的 profile。',
  };
}

function sortProfiles(a: ProfileRecord, b: ProfileRecord): number {
  const left = Date.parse(a.lastUsedAt ?? a.updatedAt);
  const right = Date.parse(b.lastUsedAt ?? b.updatedAt);
  return right - left;
}

function sanitizeName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Profile 名称不能为空。');
  }

  return trimmed;
}

function normalizeTags(tags?: string[]): string[] {
  if (!tags) {
    return [];
  }

  return Array.from(
    new Set(
      tags
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, '\n').trimEnd() + '\n';
}

function getDefaultCodexHome(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.USERPROFILE ?? os.homedir(), '.codex');
  }

  return path.join(os.homedir(), '.codex');
}

async function restartCodexOnWindows(): Promise<void> {
  try {
    await execFileAsync('taskkill.exe', ['/IM', 'Codex.exe', '/F'], {
      windowsHide: true,
    });
  } catch (error) {
    const message = getExecErrorMessage(error);
    const benign = message.includes('not found') || message.includes('没有运行') || message.includes('not running');

    if (!benign) {
      throw new Error(`关闭当前 Codex 进程失败：${message}`);
    }
  }

  await delay(900);

  const appId = 'shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App';

  try {
    await execFileAsync('explorer.exe', [appId], {
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`重新打开 Codex 失败：${getExecErrorMessage(error)}`);
  }
}

async function restartCodexOnMac(): Promise<void> {
  try {
    await execFileAsync('osascript', ['-e', 'tell application "Codex" to quit']);
  } catch {
    // Ignore quit failures and attempt to open anyway.
  }

  await delay(600);

  try {
    await execFileAsync('open', ['-a', 'Codex']);
  } catch (error) {
    throw new Error(`重新打开 Codex 失败：${getExecErrorMessage(error)}`);
  }
}

function getExecErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return '未知错误';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getObject(source: UnknownRecord | undefined, key: string): UnknownRecord | undefined {
  const value = source?.[key];
  return isRecord(value) ? value : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
