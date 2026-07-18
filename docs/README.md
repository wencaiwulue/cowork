# Synapse Desktop - Claude Code Desktop UI

## 项目概述

基于 Claude Code CLI 构建的增强型桌面应用，提供完整的可视化管理界面，支持：
- 多会话聊天和工作区管理
- Agent/Teams 全生命周期管理
- MCP 服务器和 Skills 可视化管理
- 定时任务调度
- 完整的 JSON-RPC 活动追踪和调试

## 文档导航

### 需求文档 (`docs/requirements/`)
- [产品需求文档](./requirements/PRD.md) - 功能需求和用户场景
- [UI/UX 设计说明](./requirements/UI-UX.md) - 界面设计和交互逻辑

### 技术文档 (`docs/technical/`)
- [架构设计](./architecture/ARCHITECTURE.md) - 系统架构和模块划分
- [IPC 通信协议](./technical/IPC.md) - 主进程/渲染进程通信规范
- [RPC 活动追踪](./technical/RPC-TRACING.md) - JSON-RPC 消息捕获实现

## 快速开始

```bash
# 安装依赖
bun install

# 开发模式启动
bun run desktop:dev

# 构建生产版本
bun run desktop:build
```

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| ⌘1 | Chat |
| ⌘2 | Agents |
| ⌘3 | Teams |
| ⌘4 | Tasks |
| ⌘5 | MCP Servers |
| ⌘6 | Skills |
| ⌘7 | Settings |
| ⌘K | 命令面板 |

## 开发规范

- 每个功能完成后更新对应文档
- 提交时间使用周末时间戳
- 提交信息清晰描述功能变更
- 提交前确保 TypeScript 编译和构建通过
