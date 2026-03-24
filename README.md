# Codex Profile Switcher

一个基于 `Tauri + React + TypeScript + Rust` 的轻量桌面工具，用来管理和切换 Codex 的本地 profile。

项目目标很明确：只保留配置切换需要的核心能力，不做网络共享、远程同步这类偏重功能。

## 当前能力

- 展示当前 `.codex` 配置，并识别它是否与已保存 profile 完全匹配
- 手动创建 profile
- 将当前默认目录中的配置保存为新 profile
- 查看、编辑、删除已保存 profile
- 一键切换 `auth.json` 和 `config.toml`
- 切换前自动同步当前活跃 profile，避免运行过程中追加的配置丢失
- 切换前自动备份当前配置
- 切换后统一历史会话的 provider 标签，让聊天记录继续可见
- 支持覆盖默认的 Codex Home 路径

## 会话跟随策略

这版不再复制 session 文件，而是在切换 profile 后直接统一 provider 标签：

- 更新 `sessions/` 和 `archived_sessions/` 中每个会话首条 `session_meta.payload.model_provider`
- 动态扫描 `state.sqlite` 和 `state_*.sqlite`
- 只有检测到 `threads.model_provider` 字段时才写入，降低兼容性风险

这样做的目的，是让 Codex 在切换 provider 后仍然能看到同一批历史记录，而不是分裂成多份。

## 兼容性修复

项目会自动修复一类旧配置问题：

- 如果历史 profile 使用了非法自定义 provider `openai`
- 启动时会自动改写为合法值 `openai_custom`

这样可以避免旧 profile 因为保留 provider 名称冲突而无法继续使用。

## 默认配置目录

- macOS / Linux: `~/.codex`
- Windows: `%USERPROFILE%\\.codex`

## 技术栈

- Tauri 2
- Rust
- React
- TypeScript
- Vite
- rusqlite

## 本地开发

先安装 Rust 工具链，然后执行：

```bash
npm install
npm run tauri:dev
```

如果只想验证前端构建：

```bash
npm run build
```

## 打包

```bash
npm run tauri:build
```

打包后的安装器会生成在：

```text
src-tauri/target/release/bundle/
```

仓库中的最终发布包同步放在：

```text
release/
```

## 项目结构

- `src/`: React 界面
- `src-tauri/`: Tauri 配置与 Rust 后端
- `shared/`: 前后端共享类型定义
- `release/`: 已构建好的 Windows 发布包

## License

MIT
