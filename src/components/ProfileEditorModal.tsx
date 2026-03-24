import { useEffect, useState } from 'react';

import type { CurrentConfigState, ProfileRecord } from '../../shared/contracts';

type EditorMode = 'manual' | 'capture' | 'edit';

export interface ProfileEditorSubmitPayload {
  name: string;
  note: string;
  authContent: string;
  configContent: string;
}

interface ProfileEditorModalProps {
  mode: EditorMode;
  current?: CurrentConfigState;
  profile?: ProfileRecord;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: ProfileEditorSubmitPayload) => Promise<void> | void;
}

export function ProfileEditorModal({
  mode,
  current,
  profile,
  busy,
  onClose,
  onSubmit,
}: ProfileEditorModalProps) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [authContent, setAuthContent] = useState('');
  const [configContent, setConfigContent] = useState('');

  useEffect(() => {
    if (mode === 'edit' && profile) {
      setName(profile.name);
      setNote(profile.note);
      setAuthContent(profile.authContent);
      setConfigContent(profile.configContent);
      return;
    }

    if (mode === 'capture') {
      setName('');
      setNote('');
      setAuthContent(current?.authContent ?? '');
      setConfigContent(current?.configContent ?? '');
      return;
    }

    setName('');
    setNote('');
    setAuthContent('{\n  "auth_mode": "chatgpt"\n}\n');
    setConfigContent('model = "gpt-5.4"\n');
  }, [current, mode, profile]);

  const title =
    mode === 'manual'
      ? '手动创建 Profile'
      : mode === 'capture'
        ? '保存当前配置'
        : '编辑 Profile';

  const subtitle =
    mode === 'manual'
      ? '适合手工归档一套完整的 auth.json 和 config.toml。'
      : mode === 'capture'
        ? '会从当前默认目录中读取 auth.json 与 config.toml。'
        : '可以修改名称、备注和两份配置文本。';

  const canCapture = Boolean(current?.authContent && current?.configContent);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await onSubmit({
      name,
      note,
      authContent,
      configContent,
    });
  }

  return (
    <div className="modal-backdrop">
      <section className="dialog-card dialog-card--editor">
        <div className="dialog-head">
          <div>
            <p className="eyebrow">Profile Editor</p>
            <h3>{title}</h3>
            <p className="subtle-text">{subtitle}</p>
          </div>
          <button type="button" className="button button--muted" disabled={busy} onClick={onClose}>
            关闭
          </button>
        </div>

        <form className="form-stack" onSubmit={handleSubmit}>
          <label className="field">
            <span>Profile 名称</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：工作环境 / 个人账号 / 备用配置"
              required
            />
          </label>

          <label className="field">
            <span>备注</span>
            <textarea
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="写一点用途说明，后面切换时更容易识别。"
            />
          </label>

          {mode === 'capture' ? (
            <div className="capture-panel">
              <p>
                当前会读取：
                <strong> {current?.authPath ?? 'auth.json'} </strong>
                与
                <strong> {current?.configPath ?? 'config.toml'} </strong>
              </p>
              <p>
                {canCapture
                  ? '当前配置完整，可以直接保存。'
                  : '当前目录里的配置还不完整，补齐两个文件后才能保存。'}
              </p>
            </div>
          ) : (
            <div className="code-grid">
              <label className="field">
                <span>`auth.json` 内容</span>
                <textarea
                  rows={14}
                  className="code-input"
                  value={authContent}
                  onChange={(event) => setAuthContent(event.target.value)}
                  required
                />
              </label>

              <label className="field">
                <span>`config.toml` 内容</span>
                <textarea
                  rows={14}
                  className="code-input"
                  value={configContent}
                  onChange={(event) => setConfigContent(event.target.value)}
                  required
                />
              </label>
            </div>
          )}

          <div className="dialog-actions">
            <button type="button" className="button button--muted" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={busy || (mode === 'capture' && !canCapture)}
            >
              {busy ? '处理中...' : mode === 'edit' ? '保存修改' : '确认保存'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
