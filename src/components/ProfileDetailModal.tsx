import type { ProfileRecord } from '../../shared/contracts';
import { formatTimestamp, getIdentityLabel, summarizeProfile } from '../utils/profile-ui';

interface ProfileDetailPanelProps {
  profile: ProfileRecord;
  busySwitch: boolean;
  isCurrent: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSwitch: () => void;
}

export function ProfileDetailPanel({
  profile,
  busySwitch,
  isCurrent,
  onClose,
  onEdit,
  onDelete,
  onSwitch,
}: ProfileDetailPanelProps) {
  return (
    <section className="detail-panel">
      <div className="detail-panel-card">
        <div className="detail-panel-header">
          <div>
            <p className="eyebrow">Profile Detail</p>
            <h3>{profile.name}</h3>
            <p className="modal-subtitle">{getIdentityLabel(profile)}</p>
          </div>

          <button type="button" className="ghost-button" onClick={onClose}>
            收起
          </button>
        </div>

        <div className="detail-hero detail-hero--panel">
          <span className={`badge ${isCurrent ? 'badge--current' : 'badge--muted'}`}>
            {isCurrent ? '当前配置' : profile.source === 'captured' ? '当前快照' : '已保存 Profile'}
          </span>
          <p className="detail-note">{profile.note || '没有备注。'}</p>
        </div>

        <div className="summary-grid summary-grid--panel">
          <SummaryItem label="账号" value={profile.summary.email ?? profile.summary.accountId ?? '未识别'} />
          <SummaryItem label="模型" value={profile.summary.model ?? '未设置'} />
          <SummaryItem label="计划" value={profile.summary.planType ?? '未设置'} />
          <SummaryItem label="推理强度" value={profile.summary.reasoningEffort ?? '未设置'} />
          <SummaryItem label="沙箱" value={profile.summary.sandboxMode ?? '未设置'} />
          <SummaryItem label="更新时间" value={formatTimestamp(profile.updatedAt)} />
        </div>

        <div className="meta-chip-row">
          {(profile.tags.length === 0 ? ['暂无标签'] : profile.tags).map((tag) => (
            <span key={tag} className="chip chip--soft">
              {tag === '暂无标签' ? tag : `#${tag}`}
            </span>
          ))}
          <span className="chip chip--soft">{summarizeProfile(profile) || '基础摘要'}</span>
        </div>

        <div className="detail-actions detail-actions--panel">
          <button type="button" className="secondary-button" onClick={onEdit}>
            编辑
          </button>
          <button type="button" className="ghost-button" onClick={onDelete}>
            删除
          </button>
          <button type="button" className="primary-button" onClick={onSwitch} disabled={busySwitch}>
            {busySwitch ? '切换中...' : isCurrent ? '重新写入当前' : '切换到当前'}
          </button>
        </div>

        <div className="raw-stack">
          <details className="raw-card">
            <summary>`auth.json` 原始内容</summary>
            <pre>{profile.authContent}</pre>
          </details>
          <details className="raw-card">
            <summary>`config.toml` 原始内容</summary>
            <pre>{profile.configContent}</pre>
          </details>
        </div>
      </div>
    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
