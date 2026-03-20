import { startTransition, useDeferredValue, useEffect, useState } from 'react';

import type { AppSnapshot, ProfileRecord } from '../shared/contracts';
import { ProfileDetailPanel } from './components/ProfileDetailModal';
import { ProfileEditorModal, type ProfileEditorSubmitPayload } from './components/ProfileEditorModal';
import { formatTimestamp, matchesSearch } from './utils/profile-ui';
import './styles.css';

type BannerTone = 'success' | 'error' | 'info';
type EditorState =
  | { mode: 'manual' }
  | { mode: 'capture' }
  | { mode: 'edit' };

interface BannerState {
  tone: BannerTone;
  text: string;
}

interface RestartHintState {
  title: string;
  detail: string;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [detailProfileId, setDetailProfileId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [restartHint, setRestartHint] = useState<RestartHintState | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    void loadInitialState();
  }, []);

  useEffect(() => {
    if (!banner) {
      return;
    }

    const timer = window.setTimeout(() => setBanner(null), 5000);
    return () => window.clearTimeout(timer);
  }, [banner]);

  async function loadInitialState() {
    setBusyAction('load');

    try {
      const nextSnapshot = await window.codexApi.getAppState();
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
      setDetailProfileId((previousId) =>
        previousId && nextSnapshot.profiles.some((item) => item.id === previousId) ? previousId : null,
      );
    });
  }

  async function runAction(actionKey: string, action: () => Promise<void>) {
    setBusyAction(actionKey);

    try {
      await action();
    } catch (error) {
      setBanner({
        tone: 'error',
        text: getErrorMessage(error),
      });
    } finally {
      setBusyAction(null);
    }
  }

  const profiles = snapshot?.profiles ?? [];
  const filteredProfiles = profiles.filter((profile) => matchesSearch(profile, deferredSearchQuery));
  const detailProfile = profiles.find((item) => item.id === detailProfileId) ?? null;
  const matchedProfileId = snapshot?.current.recognition.matchedProfileId ?? null;
  const currentProfileName = snapshot?.current.recognition.matchedProfileName ?? null;

  async function handleEditorSubmit(payload: ProfileEditorSubmitPayload) {
    if (!editor || !snapshot) {
      return;
    }

    await runAction(`editor:${editor.mode}`, async () => {
      if (editor.mode === 'manual') {
        const nextSnapshot = await window.codexApi.createProfile({
          ...payload,
          source: 'manual',
        });
        applySnapshot(nextSnapshot);
        setBanner({
          tone: 'success',
          text: `已创建 profile “${payload.name}”。`,
        });
      }

      if (editor.mode === 'capture') {
        const nextSnapshot = await window.codexApi.captureCurrentProfile({
          name: payload.name,
          note: payload.note,
          tags: payload.tags,
        });
        applySnapshot(nextSnapshot);
        setBanner({
          tone: 'success',
          text: `当前配置已保存为新 profile “${payload.name}”。`,
        });
      }

      if (editor.mode === 'edit' && detailProfile) {
        const nextSnapshot = await window.codexApi.updateProfile({
          id: detailProfile.id,
          name: payload.name,
          note: payload.note,
          tags: payload.tags,
          authContent: payload.authContent,
          configContent: payload.configContent,
          source: detailProfile.source,
        });
        applySnapshot(nextSnapshot);
        setBanner({
          tone: 'success',
          text: `已更新 profile “${payload.name}”。`,
        });
      }

      setEditor(null);
    });
  }

  async function handleSwitchProfile(profile: ProfileRecord) {
    await runAction(`switch:${profile.id}`, async () => {
      const result = await window.codexApi.switchProfile(profile.id);
      const nextSnapshot = await window.codexApi.getAppState();

      applySnapshot(nextSnapshot);
      setRestartHint({
        title: '已写入新的 Codex 默认配置',
        detail: '为了确保 Codex 重新读取 auth.json 和 config.toml，建议现在重启 Codex。',
      });
      setBanner({
        tone: 'success',
        text: `已切换到 “${result.profile.name}”，原配置已备份到 ${result.backupDir}。`,
      });
    });
  }

  async function handleDeleteProfile(profile: ProfileRecord) {
    const confirmed = window.confirm(`确认删除 profile “${profile.name}”？此操作不会删除当前 Codex 默认配置文件。`);
    if (!confirmed) {
      return;
    }

    await runAction(`delete:${profile.id}`, async () => {
      const nextSnapshot = await window.codexApi.deleteProfile(profile.id);
      applySnapshot(nextSnapshot);
      setDetailProfileId(null);
      setBanner({
        tone: 'success',
        text: `已删除 profile “${profile.name}”。`,
      });
    });
  }

  async function handleSaveCodexHome() {
    if (!snapshot) {
      return;
    }

    await runAction('set-home', async () => {
      const normalizedPath = pathInput.trim();
      const nextSnapshot =
        normalizedPath === snapshot.settings.defaultCodexHome
          ? await window.codexApi.setCodexHome({})
          : await window.codexApi.setCodexHome({ path: normalizedPath });

      applySnapshot(nextSnapshot);
      setRestartHint({
        title: '已更新 Codex 配置目录',
        detail: '如果你当前正开着 Codex，建议重启一次，让它用新的默认目录重新读取配置。',
      });
      setBanner({
        tone: 'success',
        text: `Codex 配置目录已更新为 ${nextSnapshot.settings.codexHome}。`,
      });
      setSettingsOpen(false);
    });
  }

  async function handleResetCodexHome() {
    await runAction('reset-home', async () => {
      const nextSnapshot = await window.codexApi.setCodexHome({});
      applySnapshot(nextSnapshot);
      setRestartHint({
        title: '已恢复默认 Codex 目录',
        detail: '为了避免 Codex 继续使用旧路径缓存，建议重启一次再继续使用。',
      });
      setBanner({
        tone: 'info',
        text: `已恢复默认 Codex 配置目录：${nextSnapshot.settings.defaultCodexHome}。`,
      });
      setSettingsOpen(false);
    });
  }

  async function handleOpenCodexHome() {
    await runAction('open-home', async () => {
      await window.codexApi.openCodexHome();
    });
  }

  async function handleRestartCodex() {
    const confirmed = window.confirm(
      '这会关闭当前打开的 Codex 窗口并重新启动它。若你正通过 Codex 进行中的会话工作，当前会话界面可能会被中断。继续吗？',
    );

    if (!confirmed) {
      return;
    }

    await runAction('restart-codex', async () => {
      await window.codexApi.restartCodex();
      setRestartHint(null);
      setSettingsOpen(false);
      setBanner({
        tone: 'info',
        text: '已触发 Codex 重启。若窗口尚未立即出现，请稍等几秒。',
      });
    });
  }

  if (!snapshot) {
    return (
      <main className="loading-shell">
        <div className="loading-card">
          <p className="eyebrow">Codex Profile Manager</p>
          <h1>正在读取你的 Codex 配置...</h1>
          <p>会检查默认路径、已保存 profiles，并识别当前配置属于哪一套。</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {banner ? <div className={`banner banner--${banner.tone}`}>{banner.text}</div> : null}

      <div className="page-frame">
        <header className="page-header page-header--minimal">
          <div className="page-toolbar">
            <label className="toolbar-search toolbar-search--compact">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索 Profile"
              />
            </label>

            <button type="button" className="ghost-button" onClick={() => setSettingsOpen(true)}>
              配置设置
            </button>
            <button type="button" className="ghost-button" onClick={() => void loadInitialState()}>
              {busyAction === 'load' ? '刷新中...' : '刷新状态'}
            </button>
          </div>
        </header>

        {restartHint ? (
          <section className="restart-banner">
            <div>
              <p className="eyebrow">Restart Recommended</p>
              <h2>{restartHint.title}</h2>
              <p>{restartHint.detail}</p>
            </div>

            <div className="restart-banner-actions">
              <button type="button" className="primary-button" onClick={() => void handleRestartCodex()}>
                {busyAction === 'restart-codex' ? '重启中...' : '重启 Codex'}
              </button>
              <button type="button" className="ghost-button" onClick={() => setRestartHint(null)}>
                稍后处理
              </button>
            </div>
          </section>
        ) : null}

        <div className={`workspace-shell${detailProfile ? ' workspace-shell--detail-open' : ''}`}>
          <section className="workspace-main">
            <section className="card-grid">
              <button type="button" className="action-card" onClick={() => setEditor({ mode: 'manual' })}>
                <span className="action-card-icon">+</span>
                <div>
                  <p className="card-label">ADD PROFILE</p>
                  <h2>添加 Profile</h2>
                  <p>手动录入名称、备注和两份配置内容。</p>
                </div>
              </button>

              <article className="profile-card profile-card--current">
                <div className="profile-card-topline">
                  <span className="card-label">CURRENT CODEX</span>
                  <span className="badge badge--current">当前配置</span>
                </div>

                <div className="profile-card-main">
                  <h2>{currentProfileName ?? '当前 Codex 配置'}</h2>
                  <p className="profile-card-copy">
                    {currentProfileName ? '已识别为已保存 profile' : '还没有匹配到已保存 profile'}
                  </p>
                </div>

                <div className="profile-card-meta">
                  <span>{getCurrentIdentityText(snapshot)}</span>
                  <span>{snapshot.current.summary?.email ?? snapshot.current.summary?.accountId ?? '未识别账号'}</span>
                  <span>{snapshot.current.summary?.model ?? '未读取模型'}</span>
                </div>

                <p className="profile-card-time">更新时间：{formatTimestamp(snapshot.current.updatedAt)}</p>

                <div className="profile-card-actions">
                  <button type="button" className="primary-button" onClick={() => setEditor({ mode: 'capture' })}>
                    保存为 Profile
                  </button>
                </div>
              </article>

              {filteredProfiles.length === 0 ? (
                <article className="empty-card">
                  <p className="card-label">NO RESULT</p>
                  <h2>没有找到匹配的 Profile</h2>
                  <p>可以换个关键词，或者把当前配置先保存成新的 profile。</p>
                </article>
              ) : null}

              {filteredProfiles.map((profile) => {
                const isCurrent = profile.id === matchedProfileId;
                const isDetailOpen = detailProfileId === profile.id;

                return (
                  <article
                    key={profile.id}
                    className={`profile-card${isCurrent ? ' profile-card--matched' : ''}${isDetailOpen ? ' profile-card--active' : ''}`}
                  >
                    <div className="profile-card-topline">
                      <span className="card-label">SAVED PROFILE</span>
                      <span className={`badge ${isCurrent ? 'badge--current' : 'badge--muted'}`}>
                        {isCurrent ? '当前配置' : getProfileBadgeText(profile)}
                      </span>
                    </div>

                    <div className="profile-card-main">
                      <h2>{profile.name}</h2>
                      <p className="profile-card-copy">{profile.note || '没有备注'}</p>
                    </div>

                    <div className="profile-card-meta">
                      <span>{profile.summary.email ?? profile.summary.accountId ?? '未识别账号'}</span>
                      <span>{profile.summary.model ?? '未设置模型'}</span>
                    </div>

                    <p className="profile-card-time">更新时间：{formatTimestamp(profile.updatedAt)}</p>

                    <div className="profile-card-actions">
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void handleSwitchProfile(profile)}
                        disabled={busyAction === `switch:${profile.id}`}
                      >
                        {busyAction === `switch:${profile.id}` ? '切换中...' : isCurrent ? '重新写入当前' : '切换到当前'}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => setDetailProfileId(isDetailOpen ? null : profile.id)}
                      >
                        {isDetailOpen ? '收起详情' : '查看详情'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>
          </section>

          {detailProfile ? (
            <aside className="detail-sidebar">
              <ProfileDetailPanel
                profile={detailProfile}
                busySwitch={busyAction === `switch:${detailProfile.id}`}
                isCurrent={detailProfile.id === matchedProfileId}
                onClose={() => setDetailProfileId(null)}
                onEdit={() => setEditor({ mode: 'edit' })}
                onDelete={() => void handleDeleteProfile(detailProfile)}
                onSwitch={() => void handleSwitchProfile(detailProfile)}
              />
            </aside>
          ) : null}
        </div>
      </div>

      {editor ? (
        <ProfileEditorModal
          mode={editor.mode}
          current={snapshot.current}
          profile={editor.mode === 'edit' ? detailProfile ?? undefined : undefined}
          busy={busyAction?.startsWith('editor:') ?? false}
          onClose={() => setEditor(null)}
          onSubmit={handleEditorSubmit}
        />
      ) : null}

      {settingsOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card modal-card--settings">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Manager Settings</p>
                <h3>配置设置</h3>
                <p className="modal-subtitle">把不常用的目录和重启动作收在这里，主页只保留配置卡片。</p>
              </div>

              <button type="button" className="ghost-button" onClick={() => setSettingsOpen(false)}>
                关闭
              </button>
            </div>

            <div className="settings-stack">
              <label className="field">
                <span>Codex 配置目录</span>
                <input
                  value={pathInput}
                  onChange={(event) => setPathInput(event.target.value)}
                  placeholder={snapshot.settings.defaultCodexHome}
                />
              </label>

              <div className="settings-grid">
              <div className="settings-block">
                  <span>默认路径</span>
                  <strong>{snapshot.settings.defaultCodexHome}</strong>
                </div>
                <div className="settings-block">
                  <span>Profiles 存储</span>
                  <strong>{snapshot.settings.profilesPath}</strong>
                </div>
                <div className="settings-block">
                  <span>备份目录</span>
                  <strong>{snapshot.settings.backupsDir}</strong>
                </div>
              </div>

              <div className="settings-actions">
                <button type="button" className="primary-button" onClick={() => void handleSaveCodexHome()}>
                  {busyAction === 'set-home' ? '保存中...' : '保存路径'}
                </button>
                <button type="button" className="ghost-button" onClick={() => void handleResetCodexHome()}>
                  恢复默认
                </button>
                <button type="button" className="ghost-button" onClick={() => void handleOpenCodexHome()}>
                  打开目录
                </button>
                <button type="button" className="secondary-button" onClick={() => void handleRestartCodex()}>
                  重启 Codex
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function getCurrentIdentityText(snapshot: AppSnapshot): string {
  if (snapshot.current.summary?.authMode === 'chatgpt') {
    return '官方 OAuth';
  }

  if (snapshot.current.summary?.hasApiKey) {
    return 'API Key';
  }

  return getRecognitionShortLabel(snapshot.current.recognition.status);
}

function getProfileBadgeText(profile: ProfileRecord): string {
  if (profile.summary.email || profile.summary.accountId) {
    return '已识别';
  }

  return '未识别';
}

function getRecognitionShortLabel(status: AppSnapshot['current']['recognition']['status']): string {
  switch (status) {
    case 'exact':
      return '已识别';
    case 'likely':
      return '接近匹配';
    case 'missing':
      return '配置缺失';
    case 'unknown':
    default:
      return '未识别';
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return '操作失败，请稍后再试。';
}
