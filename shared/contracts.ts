export type ProfileSource = 'manual' | 'captured';

export interface ProfileSummary {
  authMode: string;
  email?: string;
  accountId?: string;
  planType?: string;
  organizations: string[];
  model?: string;
  reasoningEffort?: string;
  sandboxMode?: string;
  endpoint?: string;
  hasApiKey: boolean;
}

export interface ProfileRecord {
  id: string;
  name: string;
  note: string;
  tags: string[];
  source: ProfileSource;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  fingerprint: string;
  authContent: string;
  configContent: string;
  summary: ProfileSummary;
}

export interface RecognitionResult {
  status: 'missing' | 'exact' | 'likely' | 'unknown';
  matchedProfileId?: string;
  matchedProfileName?: string;
  confidence: number;
  reason: string;
}

export interface CurrentConfigState {
  codexHome: string;
  authPath: string;
  configPath: string;
  authExists: boolean;
  configExists: boolean;
  updatedAt?: string;
  fingerprint?: string;
  summary?: ProfileSummary;
  authContent?: string;
  configContent?: string;
  recognition: RecognitionResult;
}

export interface AppSettings {
  codexHome: string;
  defaultCodexHome: string;
  profilesPath: string;
  settingsPath: string;
  backupsDir: string;
}

export interface AppSnapshot {
  profiles: ProfileRecord[];
  current: CurrentConfigState;
  settings: AppSettings;
}

export interface SaveProfileInput {
  name: string;
  note?: string;
  tags?: string[];
  authContent: string;
  configContent: string;
  source: ProfileSource;
}

export interface UpdateProfileInput extends SaveProfileInput {
  id: string;
}

export interface CaptureCurrentInput {
  name: string;
  note?: string;
  tags?: string[];
}

export interface SetCodexHomeInput {
  path?: string;
}

export interface SwitchProfileResult {
  switchedAt: string;
  backupDir: string;
  profile: ProfileRecord;
  current: CurrentConfigState;
}

export interface CodexApi {
  getAppState: () => Promise<AppSnapshot>;
  createProfile: (input: SaveProfileInput) => Promise<AppSnapshot>;
  captureCurrentProfile: (input: CaptureCurrentInput) => Promise<AppSnapshot>;
  updateProfile: (input: UpdateProfileInput) => Promise<AppSnapshot>;
  deleteProfile: (id: string) => Promise<AppSnapshot>;
  switchProfile: (id: string) => Promise<SwitchProfileResult>;
  setCodexHome: (input: SetCodexHomeInput) => Promise<AppSnapshot>;
  openCodexHome: () => Promise<void>;
  restartCodex: () => Promise<void>;
}
