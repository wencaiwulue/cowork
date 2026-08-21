<div align="center">

# Synapse Desktop

**生产可用的 Claude Code 桌面客户端，Agent 全步骤可视化**

[![Electron](https://img.shields.io/badge/Electron-33+-47848F?logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18+-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-严格模式-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)]()

[English](./README.md) | [项目文档](./docs/README.md)

---

</div>

## ✨ 功能特性

### 🎯 一级导航（快捷键 ⌘1-⌘7）

| 页面 | 快捷键 | 功能说明 |
|------|--------|---------|
| **Chat** | ⌘1 | 多会话聊天，完整编辑器支持 |
| **Agents** | ⌘2 | Agent 目录、启动任务、自定义创建、运行监控 |
| **Teams** | ⌘3 | 团队管理、成员生命周期、群组消息 |
| **Tasks** | ⌘4 | 项目级和全局定时任务管理 |
| **MCP** | ⌘5 | Model Context Protocol 服务器管理、健康检查 |
| **Skills** | ⌘6 | 技能安装、创建、用户/项目范围管理 |
| **Settings** | ⌘7 | 分组配置、插件管理、诊断导出 |

### 🔍 完整 JSON-RPC 活动追踪

- **全量可见**：每一条 JSON-RPC 消息都会被捕获（入站 + 出站）
- **实时时间线**：流式事件、工具调用、思考块、权限请求全部可见
- **双向流量**：同时显示 ↓ 运行时入站事件 和 ↑ 用户出站命令
- **结构化查看**：解析后的元数据（工具名、内容、思考过程）+ 原始 JSON 数据
- **过滤器**：全部 / 工具 / 消息 / 系统 四个分类标签
- **导出功能**：将完整活动日志导出为 JSON 文件用于调试
- **自动滚动**：实时跟随新消息到达自动滚动

### 🎨 Codex 风格 UI

- 简洁的侧边栏导航
- 持久化会话列表与状态指示器
- 分栏详情视图
- 命令面板（⌘K）快速操作
- 设置页面分组布局对齐 Codex 交互规范

### 🧩 A2UI 声明式界面

- **来自 MCP 或 Claude 的声明式 UI**：MCP server 或 Claude 自身可以发送 A2UI v0.9.1 消息载荷；桌面端通过官方 `@a2ui/react` 渲染器将其渲染为真实 React 组件，直接嵌入到对话流中
- **完整 18 组件基础目录**：卡片、列表、表单、标签页、模态框、Markdown 文本、图片和媒体播放器均由上游渲染器覆盖，无需手写任何组件代码
- **交互回流**：用户在 `RenderUI` 发起的界面上的点击和表单提交，会作为 `tool_result` 消息回传给模型，恢复被挂起的对话轮次
- **默认关闭**：`RenderUI` 内置工具需要同时满足 `A2UI_RENDER_UI` 构建开关和 `CLAUDE_CODE_ENTRYPOINT=claude-desktop` 两个条件才会生效；在 CLI 和 SDK 上下文中该工具不可见
- **当前边界**：MCP 来源界面的交互尚未回传到原始 MCP server（Phase-3 缺口）；远程图片和媒体因现有 CSP 被拦截；在真实 Electron 窗口中的端到端验证有待渲染器构建问题修复后完成

## 🚀 快速开始

### 环境依赖

- **Bun** 1.3+（[安装](https://bun.sh)）
- **Node.js** 22+
- **macOS** 12+（主要支持平台；Windows/Linux 通过 Electron 兼容）

### 启动项目

```bash
# 克隆仓库
git clone git@github.com:wencaiwulue/synapse.git
cd synapse

# 安装依赖（含 @a2ui/react、@a2ui/web_core、@a2ui/markdown-it）
bun install

# 开发模式启动（支持热重载）
bun run desktop:dev

# 构建生产版本
bun run desktop:build
```

### NPM 脚本说明

| 命令 | 说明 |
|------|------|
| `bun run desktop:dev` | 启动 Vite 开发服务器 + Electron（热更新） |
| `bun run desktop:build` | 构建 main、preload、renderer 生产版本 |
| `bun run desktop:check` | TypeScript 类型检查 + 完整构建 |
| `bun run desktop:test` | 运行桌面端测试套件 |
| `bun run desktop:test-renderer` | 运行基于 jsdom 的渲染器测试及 A2UI 一致性测试 |
| `bun run wcommit "提交信息"` | 周末时间戳自动提交推送 |

## 🏗️ 系统架构

```
┌──────────────────────────────────────────────────────┐
│                 Electron 应用                        │
├──────────────────────┬───────────────────────────────┤
│  渲染进程 (React)    │  主进程 (Node.js)              │
│                      │                               │
│  • UI 组件           │  • 会话管理器                  │
│  • 状态管理          │  • CLI 子进程宿主              │
│  • RPC 活动界面      │  • IPC 路由 + 参数校验         │
│  • 时间线查看器      │  • MCP/Skills/配置服务         │
└──────────────────────┴───────────────────────────────┘
                         │ stdio / NDJSON 通信
                         ▼
              ┌─────────────────────────┐
              │  Claude Code CLI        │
              │  (Agent 运行时)         │
              └─────────────────────────┘
```

更多架构细节请查看 [架构文档](./docs/architecture/ARCHITECTURE.md)。

## 📁 项目结构

```
synapse/
├── desktop/
│   ├── main/           # Electron 主进程
│   │   ├── ipc.ts      # IPC 类型定义和处理器
│   │   ├── sessionManager.ts  # 会话管理
│   │   ├── messageMapper.ts   # 消息映射
│   │   └── ...
│   ├── renderer/       # React UI
│   │   └── src/
│   │       ├── App.tsx
│   │       ├── a2ui/       # A2UI 渲染器模块
│   │       └── styles.css
│   ├── preload/        # contextBridge 预加载
│   └── scripts/        # 构建/开发脚本
├── src/                # CLI 源码
├── docs/               # 项目文档
└── scripts/            # 仓库脚本（周末提交等）
```

## 📊 RPC 活动查看器

导航到 **Agents（⌘2）→ Activity** 标签页即可使用完整的 JSON-RPC 检查器。

**捕获的数据范围：**

| 方向 | 类型 | 示例 |
|------|------|------|
| ↓ 入站 | stream_event | content_block_start/stop/delta、message_delta、message_stop |
| ↓ 入站 | tool_use | Bash、Read、Write、Edit、MCP 工具（含完整输入 JSON） |
| ↓ 入站 | thinking | 模型完整思考块 |
| ↓ 入站 | permission_request | 工具使用权限请求 |
| ↓ 入站 | agent_task_update | Agent 任务生命周期：pending → running → completed/failed |
| ↓ 入站 | system、result | 系统消息、最终结果 |
| ↓ 入站 | runtime:stderr | Claude 运行时所有 stderr 输出 |
| ↑ 出站 | user-send | 用户聊天消息 |
| ↑ 出站 | agent:launch | Agent 任务启动请求 |
| ↑ 出站 | team:send | 团队/群组消息 |

点击任一条目可查看详情：
- 元数据（时间戳、类型、会话 ID、方向）
- 解析后的内容（工具名、文本、思考过程）
- **完整原始 JSON-RPC 载荷**（语法高亮查看器）

## 🤝 开发规范

1. 从 `master` 分支创建功能分支
2. 确保 TypeScript 编译通过：`bun run check`
3. 新增功能需要更新 `docs/` 下对应文档
4. 使用周末时间戳提交：`bun run wcommit "feat: 描述"`

**周末提交脚本特性：**
- 自动设置 commit 时间为周末（周六/周日）
- 每次提交时间戳递增（至少晚于上一次一小时）
- 支持未来周末日期
- 自动 add → commit → push 到 master

## 📝 开源协议

MIT

---

<div align="center">
<sub>基于 Anthropic Claude Code 构建</sub>
</div>
