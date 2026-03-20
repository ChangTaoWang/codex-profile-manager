# Codex Profile Manager

一个基于 Electron + React + TypeScript 的桌面工具，用来管理和切换 Codex 的 `auth.json` / `config.toml`。

它把不同 Codex 配置收进同一个工作台里：当前配置只保留一眼能看懂的状态，其余 profile 以卡片形式展示，需要时再查看详情并快速切换。

## 功能

- 展示当前 Codex 配置，并标注当前命中的 profile
- 手动添加 profile
- 将当前默认配置保存为新的 profile
- 搜索、查看并管理已保存 profiles
- 一键切换 `auth.json` 和 `config.toml`
- 切换前自动备份当前配置
- 修改 Codex Home 路径
- 在切换配置后提示并支持重启 Codex

## 默认配置目录

- macOS / Linux: `~/.codex`
- Windows: `%USERPROFILE%\\.codex`

## 技术栈

- Electron
- React
- TypeScript
- Vite

## 本地开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 打包安装包

```bash
npm run dist
```

Windows 安装包默认输出到：

```text
release/Codex Profile Manager Setup 0.1.0.exe
```

## 项目结构

- `electron/`：主进程、预加载层、Codex 配置服务
- `src/`：React 界面
- `shared/`：前后端共用的类型定义

## GitHub 建议

- 建议不要把 `release/` 下的安装包提交进代码仓库
- 安装包更适合放到 GitHub Releases
- 代码仓库只保留源码、说明文档和必要配置

## License

MIT
