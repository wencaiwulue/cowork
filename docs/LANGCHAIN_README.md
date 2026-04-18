# 🦜 LangChain 全家桶集成

LangChain 全家桶已成功集成到 CoWork 多智能体协作平台，提供企业级的 LLM 应用开发能力。

## ✨ 功能特性

### 🔧 Tools 模块
- **内置 Tools**: DuckDuckGo 搜索、Wikipedia 查询、Shell 命令执行
- **自定义 Tools**: 支持动态注册自定义 Tools
- **LangChain 生态**: 支持所有 LangChain 社区 Tools

### 🎯 Skills 模块
- **LCEL 编排**: 基于 LangChain Expression Language 的声明式编排
- **预置模板**: QA、Summarize、Translate、Extract 等常用模板
- **灵活组合**: 支持 Sequence、Parallel、Branch、Lambda 等多种 Chain 类型

### 📚 RAG 模块
- **文档支持**: PDF、Word、Markdown、Text、CSV、JSON、HTML
- **切分策略**: Recursive、Character、Token、Semantic 多种策略
- **Vector Store**: Qdrant（支持 Chroma、LanceDB 扩展）
- **检索策略**: Similarity、MMR、Similarity Score Threshold

### 🔍 Trace 模块
- **完整追踪**: 捕获 LLM、Chain、Tool、Retriever 全链路事件
- **本地存储**: 内置内存存储，支持持久化扩展
- **外部集成**: 可选 LangSmith、Langfuse 集成
- **实时推送**: WebSocket 实时 Trace 数据推送

## 🚀 快速开始

### 1. 安装依赖

```bash
cd /Users/fengcaiwen/agent-collab-desktop/backend
pip install -r requirements-langchain.txt
```

### 2. 配置环境变量

```bash
export OPENAI_API_KEY=your_openai_api_key

# 可选：配置 Ollama（本地模型）
export OLLAMA_BASE_URL=http://localhost:11434
```

### 3. 运行测试

```bash
# 测试模块导入
python test_langchain_install.py

# 运行功能演示
export OPENAI_API_KEY=your_key
python demo_langchain.py
```

### 4. 启动服务

```bash
python -m uvicorn app.main:app --reload
```

访问 `http://localhost:8000/docs` 查看 API 文档。

## 📖 API 概览

### Tools API

```bash
# 列出 Tools
GET /api/langchain/tools

# 执行 Tool
POST /api/langchain/tools/{name}/invoke
{
  "input": "LangChain Python",
  "config": {}
}
```

### Skills API

```bash
# 列出 Skills
GET /api/langchain/skills

# 执行 Skill
POST /api/langchain/skills/{id}/invoke
{
  "input": {
    "context": "...",
    "question": "..."
  },
  "config": {}
}
```

### RAG API

```bash
# 创建配置
POST /api/langchain/rag/configs

# 上传文档
POST /api/langchain/rag/documents
Content-Type: multipart/form-data

# RAG 问答
POST /api/langchain/rag/ask
{
  "config_id": "...",
  "question": "...",
  "streaming": false
}
```

### Trace API

```bash
# 查询 Traces
GET /api/langchain/traces?session_id=...&limit=100

# 获取 Trace 详情
GET /api/langchain/traces/{id}

# WebSocket 实时推送
WS /api/langchain/ws/trace
```

## 🔧 开发指南

### 注册自定义 Tool

```python
from app.services.langchain import get_langchain_service

async def my_custom_tool(query: str) -> str:
    return f"Result for: {query}"

service = get_langchain_service()
service.tool_manager.register_custom_tool(
    name="my_tool",
    func=my_custom_tool,
    description="My custom tool",
)
```

### 创建自定义 Skill

```python
from app.services.langchain.skills import SkillDefinition

skill = SkillDefinition(
    id="my-skill",
    name="My Skill",
    description="A custom skill",
    chain_type="sequence",
    chain_config={
        "prompt_template": "qa",
        "output_parser": "str"
    }
)

service.skill_orchestrator.register_skill(skill)
```

## 📊 项目统计

- **总代码行数**: 5200+ 行
- **模块数量**: 8 个核心模块
- **API 端点**: 30+ 个 REST API
- **依赖包**: 20+ 个核心依赖

## 📚 参考文档

- [LangChain 官方文档](https://python.langchain.com/)
- [LangChain Core API](https://api.python.langchain.com/)
- [LCEL 指南](https://python.langchain.com/docs/expression_language/)
- [LangSmith 文档](https://docs.smith.langchain.com/)

## 🤝 贡献

欢迎提交 Issue 和 PR 来改进这个项目。

## 📄 许可证

与主项目相同。

---

**最后更新**: 2026-04-17
