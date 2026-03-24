import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';

import { desktopApi } from './api';
import { ProfileDetailModal } from './components/ProfileDetailModal';
import { ProfileEditorModal, type ProfileEditorSubmitPayload } from './components/ProfileEditorModal';
import type { AppSnapshot, ProfileRecord } from '../shared/contracts';
import {
  formatTimestamp,
  getCurrentStatusLabel,
  getProfileIdentity,
  getProfileSubtitle,
  matchesSearch,
} from './utils/profile-ui';
import './styles.css';

type BannerTone = 'info' | 'success' | 'error';
type EditorMode = 'manual' | 'capture' | 'edit';

interface BannerState {
  tone: BannerTone;
  text: string;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pathInput, setPathInput] = useState('');

  const deferredSearch = useDeferredValue(searchQuery);

  useEffect(() => {
    void refreshSnapshot();
  }, []);

  useEffect(() => {
    if (!banner) {
      return;
    }

    const timer = window.setTimeout(() => setBanner(null), 4200);
    return () => window.clearTimeout(timer);
  }, [banner]);

  const profiles = snapshot?.profiles ?? [];
  const matchedProfileId = snapshot?.current.matchedProfileId ?? null;

  const filteredProfiles = useMemo(
    () => profiles.filter((profile) => matchesSearch(profile, deferredSearch)),
    [deferredSearch, profiles],
  );

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const currentMatchText =
    snapshot?.current.matchStatus === 'missing'
      ? '当前目录里缺少 auth.json 或 config.toml。'
      : snapshot?.current.matchStatus === 'exact'
        ? '已与一个已保存的 profile 完全匹配。'
        : '当前配置存在，但尚未匹配到已保存 profile。';

  async function refreshSnapshot() {
    setBusyAction('refresh');

    try {
      const nextSnapshot = await desktopApi.loadSnapshot();
      applySnapshot(nextSnapshot);
    } catch (error) {
      setBanner({
        tone: 'error',
        text: getErrorMessage(error),
      });
    } finally {
      setBusyAction(null);
    }
  }

  function applySnapshot(nextSnapshot: AppSnapshot) {
    startTransition(() => {
      setSnapshot(nextSnapshot);
      setPathInput(nextSnapshot.settings.codexHome);
      setSelectedProfileId((currentId) => {
        if (currentId && nextSnapshot.profiles.some((profile) => profile.id === currentId)) {
          return currentId;
        }

        return null;
      });
    });
  }

  async function runAction(actionKey: string, work: () => Promise<void>) {
    setBusyAction(actionKey);

    try {
      await work();
    } catch (error) {
      setBanner({
        tone: 'error',
        text: getErrorMessage(error),
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleEditorSubmit(payload: ProfileEditorSubmitPayload) {
    if (!snapshot || !editorMode) {
      return;
    }

    await runAction(`editor:${editorMode}`, async () => {
      if (editorMode === 'manual') {
        const nextSnapshot = await desktopApi.createProfile({
          ...payload,
          source: 'manual',
        });
        applySnapshot(nextSnapshot);
        setBanner({
          tone: 'success',
          text: `已创建 profile “${payload.name}”。`,
        });
      }

      if (editorMode === 'capture') {
        const nextSnapshot = await desktopApi.captureCurrentProfile({
          name: payload.name,
          note: payload.note,
        });
        applySnapshot(nextSnapshot);
        setBanner({
          tone: 'success',
          text: `当前配置已保存为 profile “${payload.name}”。`,
        });
      }

      if (editorMode === 'edit' && selectedProfile) {
        const nextSnapshot = await desktopApi.updateProfile({
          id: selectedProfile.id,
          ...payload,
          source: selectedProfile.source,
        });
        applySnapshot(nextSnapshot);
        setBanner({
          tone: 'success',
          text: `已更新 profile “${payload.name}”。`,
        });
      }

      setEditorMode(null);
    });
  }

  async function handleSwitch(profile: ProfileRecord) {
    await runAction(`switch:${profile.id}`, async () => {
      const result = await desktopApi.switchProfile(profile.id);
      const nextSnapshot = await desktopApi.loadSnapshot();
      applySnapshot(nextSnapshot);
      setSelectedProfileId(null);
      setBanner({
        tone: 'success',
        text: `已切换到 “${result.profileName}”。当前 profile 已同步，历史 provider 标签已对齐，切换前配置已备份到 ${result.backupDir}。请重启 Codex 后生效。`,
      });
    });
  }

  async function handleDelete(profile: ProfileRecord) {
    const confirmed = window.confirm(`确认删除 profile “${profile.name}”？当前 Codex 配置文件不会被一起删除。`);
    if (!confirmed) {
      return;
    }

    await runAction(`delete:${profile.id}`, async () => {
      const nextSnapshot = await desktopApi.deleteProfile(profile.id);
      applySnapshot(nextSnapshot);
      setBanner({
        tone: 'success',
        text: `已删除 profile “${profile.name}”。`,
      });
      setSelectedProfileId((currentId) => (currentId === profile.id ? null : currentId));
    });
  }

  async function handleSaveCodexHome() {
    if (!snapshot) {
      return;
    }

    await runAction('set-home', async () => {
      const rawPath = pathInput.trim();
      const nextSnapshot =
        rawPath && rawPath !== snapshot.settings.defaultCodexHome
          ? await desktopApi.setCodexHome({ path: rawPath })
          : await desktopApi.setCodexHome({});

      applySnapshot(nextSnapshot);
      setSettingsOpen(false);
      setBanner({
        tone: 'success',
        text: `目标目录已更新为 ${nextSnapshot.settings.codexHome}。`,
      });
    });
  }

  async function handleResetCodexHome() {
    await runAction('reset-home', async () => {
      const nextSnapshot = await desktopApi.setCodexHome({});
      applySnapshot(nextSnapshot);
      setSettingsOpen(false);
      setBanner({
        tone: 'info',
        text: `已恢复默认目录 ${nextSnapshot.settings.defaultCodexHome}。`,
      });
    });
  }

  async function handleOpenCodexHome() {
    await runAction('open-home', async () => {
      await desktopApi.openCodexHome();
    });
  }

  if (!snapshot) {
    return (
      <main className="app-shell app-shell--loading">
        <section className="loading-panel">
          <p className="eyebrow">Codex Profile Switcher</p>
          <h1>正在加载本地配置</h1>
          <p>如果你是从浏览器直接打开页面，请改用 `npm run tauri:dev` 或桌面安装包启动。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {banner ? <div className={`banner banner--${banner.tone}`}>{banner.text}</div> : null}

      <div className="page-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Tauri Edition</p>
            <h1>Codex Profile Switcher</h1>
            <p className="subtle-text">更轻量的本地配置切换器，只保留 profile 的保存、查看、切换和备份。</p>
          </div>

          <div className="topbar-actions">
            <label className="searchbox">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索名称、账号、模型"
              />
            </label>

            <button type="button" className="button button--primary" onClick={() => setEditorMode('manual')}>
              手动添加 Profile
            </button>
            <button type="button" className="button button--muted" onClick={() => setSettingsOpen(true)}>
              设置
            </button>
            <button type="button" className="button button--muted" onClick={() => void refreshSnapshot()}>
              {busyAction === 'refresh' ? '刷新中...' : '刷新'}
            </button>
          </div>
        </header>

        <section className="summary-strip">
          <article className="panel panel--current panel--current-compact">
            <div className="panel-head panel-head--compact">
              <div>
                <p className="eyebrow">Current Config</p>
                <h2>{snapshot.current.matchedProfileName ?? '当前 Codex 配置'}</h2>
                <p className="subtle-text current-match-text">{currentMatchText}</p>
              </div>
              <span className={`status-pill status-pill--${snapshot.current.matchStatus}`}>
                {getCurrentStatusLabel(snapshot.current.matchStatus)}
              </span>
            </div>

            <div className="meta-grid meta-grid--compact">
              <div className="meta-cell">
                <span>账号</span>
                <strong>{snapshot.current.summary ? getProfileIdentity(snapshot.current.summary) : '未识别'}</strong>
              </div>
              <div className="meta-cell">
                <span>模型</span>
                <strong>{snapshot.current.summary?.model ?? '未读取'}</strong>
              </div>
              <div className="meta-cell current-path-cell">
                <span>目标目录</span>
                <strong className="current-path-value">{snapshot.current.codexHome}</strong>
              </div>
            </div>

            <div className="panel-actions panel-actions--compact">
              <button
                type="button"
                className="button button--primary"
                disabled={!snapshot.current.authContent || !snapshot.current.configContent}
                onClick={() => setEditorMode('capture')}
              >
                保存当前配置
              </button>
              <button type="button" className="button button--muted" onClick={() => void handleOpenCodexHome()}>
                打开目录
              </button>
            </div>
          </article>
        </section>

        <section className="section-head">
          <div>
            <h2>已保存的 Profiles</h2>
            <p className="subtle-text">当前共 {profiles.length} 套配置，切换前会自动同步当前 profile，并在切换后统一 session 与状态库里的 provider 标签。</p>
          </div>
        </section>

        <section className="card-grid">
          {filteredProfiles.length === 0 ? (
            <article className="panel panel--empty">
              <h3>没有匹配结果</h3>
              <p>试试换个关键词，或者先把当前配置保存成一套新的 profile。</p>
            </article>
          ) : null}

          {filteredProfiles.map((profile) => {
            const isCurrent = profile.id === matchedProfileId;
            const switching = busyAction === `switch:${profile.id}`;

            return (
              <article
                key={profile.id}
                className={`panel panel--profile${isCurrent ? ' panel--profile-active' : ''}`}
              >
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">{profile.source === 'captured' ? 'Captured' : 'Manual'}</p>
                    <h3>{profile.name}</h3>
                  </div>
                  <span className={`status-pill ${isCurrent ? 'status-pill--exact' : 'status-pill--idle'}`}>
                    {isCurrent ? '当前生效' : profile.summary.authLabel}
                  </span>
                </div>

                <p className="card-note">{profile.note || '没有备注。'}</p>
                <p className="card-subtitle">{getProfileSubtitle(profile.summary)}</p>

                <div className="meta-row">
                  <span>{getProfileIdentity(profile.summary)}</span>
                  <span>{formatTimestamp(profile.lastUsedAt ?? profile.updatedAt)}</span>
                </div>

                <div className="panel-actions">
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={switching}
                    onClick={() => void handleSwitch(profile)}
                  >
                    {switching ? '切换中...' : isCurrent ? '重新写入' : '切换到这里'}
                  </button>
                  <button
                    type="button"
                    className="button button--muted"
                    onClick={() => setSelectedProfileId(profile.id)}
                  >
                    查看详情
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      </div>

      {selectedProfile ? (
        <ProfileDetailModal
          profile={selectedProfile}
          isCurrent={selectedProfile.id === matchedProfileId}
          busySwitch={busyAction === `switch:${selectedProfile.id}`}
          onClose={() => setSelectedProfileId(null)}
          onEdit={() => setEditorMode('edit')}
          onDelete={() => void handleDelete(selectedProfile)}
          onSwitch={() => void handleSwitch(selectedProfile)}
        />
      ) : null}

      {editorMode ? (
        <ProfileEditorModal
          mode={editorMode}
          current={snapshot.current}
          profile={editorMode === 'edit' ? selectedProfile ?? undefined : undefined}
          busy={Boolean(busyAction?.startsWith('editor:'))}
          onClose={() => setEditorMode(null)}
          onSubmit={handleEditorSubmit}
        />
      ) : null}

      {settingsOpen ? (
        <div className="modal-backdrop">
          <section className="dialog-card dialog-card--settings">
            <div className="dialog-head">
              <div>
                <p className="eyebrow">Settings</p>
                <h3>目标目录设置</h3>
                <p className="subtle-text">默认会使用 `.codex`，如果你改过目录，可以在这里覆盖。</p>
              </div>
              <button type="button" className="button button--muted" onClick={() => setSettingsOpen(false)}>
                关闭
              </button>
            </div>

            <label className="field">
              <span>Codex 配置目录</span>
              <input
                value={pathInput}
                onChange={(event) => setPathInput(event.target.value)}
                placeholder={snapshot.settings.defaultCodexHome}
              />
            </label>

            <div className="meta-grid">
              <div className="meta-cell">
                <span>默认目录</span>
                <strong>{snapshot.settings.defaultCodexHome}</strong>
              </div>
              <div className="meta-cell">
                <span>Profiles 目录</span>
                <strong>{snapshot.settings.profilesDir}</strong>
              </div>
              <div className="meta-cell">
                <span>备份目录</span>
                <strong>{snapshot.settings.backupsDir}</strong>
              </div>
            </div>

            <div className="dialog-actions">
              <button type="button" className="button button--primary" onClick={() => void handleSaveCodexHome()}>
                {busyAction === 'set-home' ? '保存中...' : '保存路径'}
              </button>
              <button type="button" className="button button--muted" onClick={() => void handleResetCodexHome()}>
                恢复默认
              </button>
              <button type="button" className="button button--muted" onClick={() => void handleOpenCodexHome()}>
                打开目录
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return '操作失败，请稍后再试。';
}
