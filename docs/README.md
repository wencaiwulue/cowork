# Synapse Desktop - 项目文档

[← 返回主 README (English)](../README.md) | [← 返回主 README (中文)](../README.zh-CN.md)

---

## 文档导航

### 📋 需求文档

| 文档 | 说明 | 语言 |
|------|------|------|
| [产品需求文档 (PRD)](./requirements/PRD.md) | 功能需求列表、用户场景、优先级追踪 | 中文 |

### 🏗️ 架构文档

| 文档 | 说明 | 语言 |
|------|------|------|
| [系统架构设计](./architecture/ARCHITECTURE.md) | 整体架构、模块划分、数据流图 | 中文 |

### 🔧 技术文档

| 文档 | 说明 | 语言 |
|------|------|------|
| [RPC 活动追踪实现](./technical/RPC-TRACING.md) | JSON-RPC 消息捕获机制和UI实现 | 中文 |

---

## 快速链接

- **GitHub**: https://github.com/wencaiwulue/synapse
- **Issues**: https://github.com/wencaiwulue/synapse/issues
- **主 README**: [English](../README.md) | [中文](../README.zh-CN.md)

## 开发指南

每完成一个功能，请按以下顺序更新：
1. 更新 `docs/requirements/PRD.md` 中对应功能状态
2. 如有架构变更，更新架构文档
3. 如涉及新的技术实现，补充技术文档
4. 使用 `bun run wcommit "提交信息"` 自动周末时间戳提交推送
