export type ProfileSource = 'manual' | 'captured';
export type MatchStatus = 'missing' | 'exact' | 'unknown';

export interface ProfileSummary {
  authLabel: string;
  authMode: string;
  email?: string;
  accountId?: string;
  planType?: string;
  model?: string;
  reasoningEffort?: string;
  endpoint?: string;
  hasApiKey: boolean;
}

export interface ProfileRecord {
  id: string;
  name: string;
  note: string;
  source: ProfileSource;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  fingerprint: string;
  authContent: string;
  configContent: string;
  summary: ProfileSummary;
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
  matchStatus: MatchStatus;
  matchedProfileId?: string;
  matchedProfileName?: string;
}

export interface AppSettings {
  codexHome: string;
  defaultCodexHome: string;
  profilesDir: string;
  statePath: string;
  backupsDir: string;
}

export interface AppSnapshot {
  profiles: ProfileRecord[];
  current: CurrentConfigState;
  settings: AppSettings;
}

export interface ProfileInput {
  name: string;
  note?: string;
  authContent: string;
  configContent: string;
  source: ProfileSource;
}

export interface UpdateProfileInput extends ProfileInput {
  id: string;
}

export interface CaptureCurrentInput {
  name: string;
  note?: string;
}

export interface SetCodexHomeInput {
  path?: string;
}

export interface SwitchProfileResult {
  switchedAt: string;
  backupDir: string;
  profileId: string;
  profileName: string;
}
