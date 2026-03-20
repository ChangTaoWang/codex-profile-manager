import { useEffect, useState } from 'react';

import type { CurrentConfigState, ProfileRecord } from '../../shared/contracts';

type EditorMode = 'manual' | 'capture' | 'edit';

export interface ProfileEditorSubmitPayload {
  name: string;
  note: string;
  tags: string[];
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
  const [tagsText, setTagsText] = useState('');
  const [authContent, setAuthContent] = useState('');
  const [configContent, setConfigContent] = useState('');

  useEffect(() => {
    if (mode === 'edit' && profile) {
      setName(profile.name);
      setNote(profile.note);
      setTagsText(profile.tags.join(', '));
      setAuthContent(profile.authContent);
      setConfigContent(profile.configContent);
      return;
    }

    if (mode === 'capture') {
      setName('');
      setNote('');
      setTagsText('');
      setAuthContent(current?.authContent ?? '');
      setConfigContent(current?.configContent ?? '');
      return;
    }

    setName('');
    setNote('');
    setTagsText('');
    setAuthContent('{\n  "auth_mode": "chatgpt"\n}\n');
    setConfigContent('model = "gpt-5.4"\n');
  }, [current, mode, profile]);

  const title =
    mode === 'manual'
      ? '手动添加 Profile'
      : mode === 'capture'
        ? '保存当前配置为新 Profile'
        : '编辑 Profile';

  const canCapture = Boolean(current?.authContent && current?.configContent);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await onSubmit({
      name,
      note,
      tags: parseTags(tagsText),
      authContent,
      configContent,
    });
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Profile Editor</p>
            <h3>{title}</h3>
          </div>
          <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </div>

        <form className="modal-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Profile 名称</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：Team 工作流 / 个人 API Key"
              required
            />
          </label>

          <label className="field">
            <span>备注</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder="记录适用场景，比如团队环境、个人实验环境、特定模型偏好等"
            />
          </label>

          <label className="field">
            <span>标签</span>
            <input
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder="用逗号分隔，例如：work, gpt-5.4, elevated"
            />
          </label>

          {mode === 'capture' ? (
            <div className="capture-note">
              <p>
                这次会直接读取当前默认配置文件：
                <strong> {current?.authPath ?? 'auth.json'} </strong>
                和
                <strong> {current?.configPath ?? 'config.toml'} </strong>
              </p>
              <p>
                {canCapture
                  ? '当前配置已读取完成，提交后会保存为新的 profile。'
                  : '当前默认配置不完整，补齐 auth.json 和 config.toml 后才能保存。'}
              </p>
            </div>
          ) : (
            <>
              <label className="field">
                <span>`auth.json` 内容</span>
                <textarea
                  className="code-field"
                  value={authContent}
                  onChange={(event) => setAuthContent(event.target.value)}
                  rows={10}
                  required
                />
              </label>

              <label className="field">
                <span>`config.toml` 内容</span>
                <textarea
                  className="code-field"
                  value={configContent}
                  onChange={(event) => setConfigContent(event.target.value)}
                  rows={8}
                  required
                />
              </label>
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={busy || (mode === 'capture' && !canCapture)}
            >
              {busy ? '处理中...' : mode === 'edit' ? '保存修改' : '确认保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function parseTags(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}
