import type { ProfileRecord } from '../../shared/contracts';
import { formatTimestamp, getProfileIdentity, getProfileSubtitle } from '../utils/profile-ui';

interface ProfileDetailModalProps {
  profile: ProfileRecord;
  isCurrent: boolean;
  busySwitch: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSwitch: () => void;
}

export function ProfileDetailModal({
  profile,
  isCurrent,
  busySwitch,
  onClose,
  onEdit,
  onDelete,
  onSwitch,
}: ProfileDetailModalProps) {
  return (
    <div className="modal-backdrop">
      <section className="dialog-card dialog-card--detail">
        <div className="dialog-head">
          <div>
            <p className="eyebrow">Profile Detail</p>
            <h3>{profile.name}</h3>
            <p className="subtle-text">{getProfileIdentity(profile.summary)}</p>
          </div>

          <button type="button" className="button button--muted" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="detail-summary">
          <div className="meta-grid">
            <div className="meta-cell">
              <span>状态</span>
              <strong>{isCurrent ? '当前生效' : profile.summary.authLabel}</strong>
            </div>
            <div className="meta-cell">
              <span>更新时间</span>
              <strong>{formatTimestamp(profile.updatedAt)}</strong>
            </div>
            <div className="meta-cell">
              <span>最近切换</span>
              <strong>{formatTimestamp(profile.lastUsedAt)}</strong>
            </div>
            <div className="meta-cell">
              <span>概览</span>
              <strong>{getProfileSubtitle(profile.summary)}</strong>
            </div>
          </div>

          <div className="note-box">
            <span>备注</span>
            <p>{profile.note || '没有备注。'}</p>
          </div>
        </div>

        <div className="dialog-actions">
          <button type="button" className="button button--muted" onClick={onEdit}>
            编辑
          </button>
          <button type="button" className="button button--muted" onClick={onDelete}>
            删除
          </button>
          <button type="button" className="button button--primary" disabled={busySwitch} onClick={onSwitch}>
            {busySwitch ? '切换中...' : isCurrent ? '重新写入当前' : '切换到当前'}
          </button>
        </div>

        <div className="code-stack">
          <section className="code-card">
            <div className="code-card-head">
              <strong>auth.json</strong>
            </div>
            <pre>{profile.authContent}</pre>
          </section>

          <section className="code-card">
            <div className="code-card-head">
              <strong>config.toml</strong>
            </div>
            <pre>{profile.configContent}</pre>
          </section>
        </div>
      </section>
    </div>
  );
}
