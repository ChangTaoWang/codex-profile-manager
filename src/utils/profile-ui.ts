import type { CurrentConfigState, ProfileRecord, RecognitionResult } from '../../shared/contracts';

export interface ProfileDifference {
  label: string;
  current: string;
  target: string;
}

export function formatTimestamp(value?: string): string {
  if (!value) {
    return '未记录';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function matchesSearch(profile: ProfileRecord, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  return [
    profile.name,
    profile.note,
    profile.summary.email,
    profile.summary.accountId,
    profile.summary.model,
    profile.summary.planType,
    profile.summary.authMode,
    profile.summary.reasoningEffort,
    ...profile.summary.organizations,
    ...profile.tags,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

export function getIdentityLabel(profile: ProfileRecord): string {
  return (
    profile.summary.email ??
    profile.summary.accountId ??
    `${profile.summary.authMode} · ${profile.summary.model ?? '未配置模型'}`
  );
}

export function getRecognitionLabel(recognition: RecognitionResult): string {
  switch (recognition.status) {
    case 'exact':
      return '精确匹配';
    case 'likely':
      return '高度接近';
    case 'missing':
      return '配置缺失';
    case 'unknown':
    default:
      return '未识别';
  }
}

export function getStatusClass(status: RecognitionResult['status']): string {
  return `pill--${status}`;
}

export function diffProfile(
  current: CurrentConfigState | undefined,
  profile: ProfileRecord,
): ProfileDifference[] {
  if (!current?.summary) {
    return [];
  }

  const differences: ProfileDifference[] = [];
  const entries: Array<[string, string | undefined, string | undefined]> = [
    ['邮箱', current.summary.email, profile.summary.email],
    ['账号 ID', current.summary.accountId, profile.summary.accountId],
    ['计划类型', current.summary.planType, profile.summary.planType],
    ['认证模式', current.summary.authMode, profile.summary.authMode],
    ['模型', current.summary.model, profile.summary.model],
    ['推理强度', current.summary.reasoningEffort, profile.summary.reasoningEffort],
    ['沙箱模式', current.summary.sandboxMode, profile.summary.sandboxMode],
    ['接口地址', current.summary.endpoint, profile.summary.endpoint],
    [
      '组织',
      current.summary.organizations.join(' / ') || undefined,
      profile.summary.organizations.join(' / ') || undefined,
    ],
  ];

  for (const [label, currentValue, targetValue] of entries) {
    const normalizedCurrent = currentValue?.trim() || '未设置';
    const normalizedTarget = targetValue?.trim() || '未设置';

    if (normalizedCurrent !== normalizedTarget) {
      differences.push({
        label,
        current: normalizedCurrent,
        target: normalizedTarget,
      });
    }
  }

  return differences;
}

export function chooseSelectedProfileId(
  profiles: ProfileRecord[],
  current: CurrentConfigState | undefined,
  preferredId?: string | null,
): string | null {
  if (preferredId && profiles.some((item) => item.id === preferredId)) {
    return preferredId;
  }

  const matchedId = current?.recognition.matchedProfileId;
  if (matchedId && profiles.some((item) => item.id === matchedId)) {
    return matchedId;
  }

  return profiles[0]?.id ?? null;
}

export function summarizeProfile(profile: ProfileRecord): string {
  return [
    profile.summary.model,
    profile.summary.reasoningEffort,
    profile.summary.planType,
  ]
    .filter(Boolean)
    .join(' · ');
}
