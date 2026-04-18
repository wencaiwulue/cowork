# LangChain 全家桶集成 - 设置指南

## 概述

本文档介绍如何设置和使用已集成到 CoWork 项目的 LangChain 全家桶功能。

## 已完成功能

### Phase 1: 基础设施 ✅
- ✅ LangChain 核心模块架构
- ✅ LLM Provider（OpenAI + Ollama）
- ✅ 基础服务框架
- ✅ FastAPI 路由集成

### Phase 2: Tools 模块 ✅
- ✅ Tools 管理器
- ✅ 内置 Tools（DuckDuckGo、Wikipedia、Shell）
- ✅ 自定义 Tool 注册
- ✅ Tools API 端点

### Phase 3: Skills 模块 ✅
- ✅ Skills 编排器
- ✅ LCEL (LangChain Expression Language) 集成
- ✅ 预置 Skills 模板
- ✅ Skills API 端点

### Phase 4: RAG 模块 ✅
- ✅ RAG 管理器
- ✅ 文档处理流程
- ✅ Vector Store 集成（Qdrant）
- ✅ RAG API 端点

### Phase 5: Trace 模块 ✅
- ✅ Trace 管理器
- ✅ Callback Handler
- ✅ 本地存储
- ✅ Trace API 端点
- ✅ WebSocket 实时推送

## 快速开始

### 1. 安装依赖

```bash
cd /Users/fengcaiwen/agent-collab-desktop/backend

# 安装 LangChain 依赖
pip install -r requirements-langchain.txt
```

### 2. 设置环境变量

```bash
# 设置 OpenAI API Key
export OPENAI_API_KEY=your_openai_api_key

# 可选：设置其他配置
export LANGCHAIN_TRACING_V2=true
export LANGCHAIN_API_KEY=your_langsmith_key  # 可选
```

### 3. 运行测试

```bash
# 测试模块导入
python test_langchain_install.py

# 运行功能演示
python demo_langchain.py --demo all
```

### 4. 启动服务

```bash
# 启动 FastAPI 服务
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## API 端点

### Tools API

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/langchain/tools` | 列出所有 Tools |
| POST | `/api/langchain/tools/{name}/invoke` | 执行 Tool |
| POST | `/api/langchain/tools/{name}/stream` | 流式执行 Tool |

### Skills API

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/langchain/skills` | 列出所有 Skills |
| POST | `/api/langchain/skills/{id}/invoke` | 执行 Skill |
| POST | `/api/langchain/skills/{id}/stream` | 流式执行 Skill |

### RAG API

| 方法 | 端点 | 描述 |
|------|------|------|
| POST | `/api/langchain/rag/configs` | 创建 RAG 配置 |
| GET | `/api/langchain/rag/configs` | 列出 RAG 配置 |
| POST | `/api/langchain/rag/documents` | 上传文档 |
| POST | `/api/langchain/rag/retrieve` | 检索文档 |
| POST | `/api/langchain/rag/ask` | RAG 问答 |

### Trace API

| 方法 | 端点 | 描述 |
|------|------|------|
| GET | `/api/langchain/trace/config` | 获取 Trace 配置 |
| PUT | `/api/langchain/trace/config` | 更新 Trace 配置 |
| GET | `/api/langchain/traces` | 查询 Traces |
| GET | `/api/langchain/traces/{id}` | 获取 Trace 详情 |
| GET | `/api/langchain/traces/{id}/tree` | 获取 Trace 树 |
| GET | `/api/langchain/traces/stats` | 获取 Trace 统计 |
| WS | `/api/langchain/ws/trace` | WebSocket 实时推送 |

## 配置说明

### LangChain 服务配置

```python
config = {
    "llm": {
        "provider": "openai",  # 或 "ollama"
        "model": "gpt-4o-mini",
        "temperature": 0.7,
        "api_key": "your_api_key",
    },
    "trace": {
        "enabled": True,
        "local_storage": {
            "enabled": True,
            "retention_days": 30,
        },
        "realtime": {
            "enabled": True,
        }
    }
}
```

## 目录结构

```
backend/
├── app/
│   ├── api/
│   │   └── langchain_routes.py      # API 路由
│   ├── services/
│   │   └── langchain/
│   │       ├── __init__.py          # 主服务入口
│   │       ├── base.py              # 基础类和混入
│   │       ├── llm.py               # LLM Provider
│   │       ├── tools.py             # Tools 管理器
│   │       ├── skills.py            # Skills 编排器
│   │       ├── rag.py               # RAG 管理器
│   │       └── trace.py             # Trace 管理器
├── docs/
│   ├── langchain-integration.md     # 需求文档
│   └── langchain-setup-guide.md     # 设置指南
├── requirements-langchain.txt       # 依赖文件
├── init_langchain.py               # 初始化脚本
├── test_langchain_install.py       # 测试脚本
└── demo_langchain.py               # 演示脚本
```

## 下一步计划

1. **前端 UI 开发** - 为 Tools、Skills、RAG、Trace 创建管理界面
2. **更多 Tools 集成** - 添加更多 LangChain 社区 Tools
3. **高级 RAG 功能** - 实现重排序、查询重写等高级功能
4. **生产优化** - 缓存、批处理、错误重试等

## 参考文档

- [LangChain 官方文档](https://python.langchain.com/)
- [LangChain Core API](https://api.python.langchain.com/)
- [LCEL 指南](https://python.langchain.com/docs/expression_language/)
- [LangSmith 文档](https://docs.smith.langchain.com/)
