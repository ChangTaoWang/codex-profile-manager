import type { MatchStatus, ProfileRecord, ProfileSummary } from '../../shared/contracts';

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
  const keyword = query.trim().toLowerCase();
  if (!keyword) {
    return true;
  }

  return [
    profile.name,
    profile.note,
    profile.summary.authLabel,
    profile.summary.email,
    profile.summary.accountId,
    profile.summary.model,
    profile.summary.reasoningEffort,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(keyword);
}

export function getProfileIdentity(summary: ProfileSummary): string {
  return summary.email ?? summary.accountId ?? summary.authLabel;
}

export function getProfileSubtitle(summary: ProfileSummary): string {
  return [summary.model, summary.reasoningEffort, summary.planType].filter(Boolean).join(' · ') || '基础配置';
}

export function getCurrentStatusLabel(status: MatchStatus): string {
  switch (status) {
    case 'exact':
      return '已匹配';
    case 'missing':
      return '配置缺失';
    case 'unknown':
    default:
      return '未匹配';
  }
}
