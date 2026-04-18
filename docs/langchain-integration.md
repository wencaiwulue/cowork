# LangChain 全家桶集成需求文档

## 1. 项目概述

### 1.1 目标
将 LangChain 全家桶整合进现有 CoWork 多智能体协作平台，提升 Agent 的 Tools、Skills、RAG、Trace 等核心能力。

### 1.2 架构决策
- **整合方式**: 整合进现有架构（非独立层）
- **优先级**: Tools > Skills > RAG > Trace
- **LLM 支持**: OpenAI + 本地模型 (Ollama/llama.cpp)
- **运行模式**: 混合模式（同步 + 异步 Streaming）

## 2. 模块需求

### 2.1 Tools 模块（P0 - 最高优先级）

#### 2.1.1 目标
集成 LangChain Tools，提供丰富的工具调用能力。

#### 2.1.2 功能需求
| 功能 | 描述 | 优先级 |
|-----|------|--------|
| LangChain Tools 集成 | 集成官方和社区 Tools | P0 |
| 自定义 Tools 框架 | 支持注册自定义 Tools | P0 |
| Tool 选择策略 | 基于描述的智能 Tool 选择 | P1 |
| Tool 执行跟踪 | Tool 调用日志和结果记录 | P1 |
| MCP Tools 支持 | 集成 MCP (Model Context Protocol) | P2 |

#### 2.1.3 技术要点
- 使用 `langchain.tools` 和 `langchain_community.tools`
- 实现 `BaseTool` 接口适配现有 Tool 系统
- Tool 调用支持 Streaming 和 Callback

### 2.2 Skills 模块（P1）

#### 2.2.1 目标
基于 LangChain 构建可复用、可编排的 Skills 系统。

#### 2.2.2 功能需求
| 功能 | 描述 | 优先级 |
|-----|------|--------|
| Skill 定义 DSL | 基于 YAML/JSON 的 Skill 定义 | P1 |
| LCEL 集成 | 使用 LangChain Expression Language 编排 | P1 |
| Chain 模板 | 预置常用 Chain 模板（LLMRouter, MapReduce等）| P1 |
| Skill 市场 | 可共享和导入导出 Skills | P2 |
| 可视化编排 | 拖拽式 Skill 编排界面 | P3 |

#### 2.2.3 技术要点
- 使用 `langchain_core.runnables` (LCEL)
- 实现 Chain 的序列化/反序列化
- Skill 版本管理和兼容性检查

### 2.3 RAG 模块（P2）

#### 2.3.1 目标
构建完整的 RAG (Retrieval-Augmented Generation) 能力。

#### 2.3.2 功能需求
| 功能 | 描述 | 优先级 |
|-----|------|--------|
| 文档加载器 | 支持多种文档格式 (PDF, Word, Markdown等) | P2 |
| 文档切分策略 | 智能 Chunking（语义/递归/固定长度）| P2 |
| Embedding 管理 | 支持多 Embedding 模型 | P2 |
| Vector Store 集成 | 集成 Qdrant/LanceDB 等 | P1 |
| 检索策略 | MMR, Similarity, Hybrid Search | P2 |
| 重排序 | Reranking 模型集成 | P3 |
| 查询重写 | Query Expansion/Transform | P3 |

#### 2.3.3 技术要点
- 使用 `langchain_community.document_loaders`
- 使用 `langchain_text_splitters`
- 使用 `langchain_community.vectorstores`
- 与现有 Mem0/Qdrant 集成

### 2.4 Trace 模块（P3）

#### 2.4.1 目标
实现完整的可观测性和调试能力。

#### 2.4.2 功能需求
| 功能 | 描述 | 优先级 |
|-----|------|--------|
| LangSmith 集成 | 云端 Tracing 和监控 | P2 |
| Langfuse 集成 | 开源 Tracing 方案 | P2 |
| 本地 Trace 存储 | 本地 Trace 记录和查询 | P1 |
| 实时流监控 | WebSocket 实时 Trace 推送 | P2 |
| Cost 追踪 | Token 消耗和成本统计 | P2 |
| 性能分析 | 延迟/吞吐量指标 | P3 |

#### 2.4.3 技术要点
- 使用 `langchain.callbacks`
- 实现自定义 CallbackHandler
- 与前端 UI Trace 视图集成

## 3. 技术架构

### 3.1 后端架构

```
┌─────────────────────────────────────────────────────────────┐
│                     FastAPI Backend                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐ │
│  │ Agent API   │ │ Team API    │ │ Session API         │ │
│  └──────┬──────┘ └──────┬──────┘ └──────────┬──────────┘ │
│         └─────────────────┴───────────────────┘            │
│                           │                                │
│  ┌────────────────────────┴────────────────────────┐      │
│  │           LangChain Integration Layer           │      │
│  ├────────────────────────────────────────────────┤      │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────┐  │      │
│  │  │  Tools   │ │  Skills  │ │     RAG        │  │      │
│  │  │  (P0)    │ │  (P1)    │ │    (P2)        │  │      │
│  │  └──────────┘ └──────────┘ └────────────────┘  │      │
│  │  ┌────────────────────────────────────────┐    │      │
│  │  │              Trace (P3)                │    │      │
│  │  │    Callbacks / LangSmith / Langfuse    │    │      │
│  │  └──────────────────────────────────────┘    │      │
│  └────────────────────────────────────────────────┘      │
│                           │                                │
│  ┌────────────────────────┴────────────────────────┐      │
│  │              LLM Provider Layer                 │      │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────┐  │      │
│  │  │  OpenAI  │ │  Ollama  │ │  llama.cpp     │  │      │
│  │  └──────────┘ └──────────┘ └────────────────┘  │      │
│  └────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 前端架构

```
┌─────────────────────────────────────────────────────────────┐
│                  React + TypeScript Frontend               │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │ Agent UI    │ │ Team UI     │ │ Chat UI             │   │
│  └──────┬──────┘ └──────┬──────┘ └──────────┬──────────┘   │
│         └─────────────────┴───────────────────┘              │
│                           │                                  │
│  ┌────────────────────────┴────────────────────────┐        │
│  │              LangChain UI Layer                 │        │
│  ├────────────────────────────────────────────────┤        │
│  │  ┌──────────────┐ ┌──────────────────────────┐  │        │
│  │  │ Tool Config  │ │ Skill Orchestration      │  │        │
│  │  └──────────────┘ └──────────────────────────┘  │        │
│  │  ┌──────────────┐ ┌──────────────────────────┐  │        │
│  │  │ RAG Settings │ │ Trace Dashboard          │  │        │
│  │  └──────────────┘ └──────────────────────────┘  │        │
│  └────────────────────────────────────────────────┘        │
│                           │                                  │
│  ┌────────────────────────┴────────────────────────┐        │
│  │              MessageBus (Core)                  │        │
│  │         Inter-agent Communication               │        │
│  └────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## 4. 实现计划

### 4.1 Phase 1: Tools 模块（1-2 周）

**任务列表**:
1. 搭建 LangChain 基础依赖
2. 实现 Tool 适配层
3. 集成常用 LangChain Tools
4. 自定义 Tool 注册机制
5. Tool 选择和执行逻辑
6. 前端 Tool 配置 UI

**技术要点**:
- 依赖: `langchain`, `langchain-community`, `langchain-openai`
- 适配现有 `backend/app/services/tools/` 系统

### 4.2 Phase 2: Skills 模块（1-2 周）

**任务列表**:
1. 设计 Skill DSL 格式
2. 实现 LCEL 运行时
3. 开发 Chain 模板库
4. Skill 序列化/反序列化
5. Skill 版本管理
6. 前端 Skill 编排 UI

**技术要点**:
- 使用 `langchain_core.runnables` (LCEL)
- 集成现有 `backend/app/services/skills/` 系统

### 4.3 Phase 3: RAG 模块（2-3 周）

**任务列表**:
1. 文档加载器集成
2. 智能 Chunking 策略
3. Embedding 管理器
4. Vector Store 适配
5. 检索策略实现
6. RAG Chain 编排
7. 前端 RAG 配置 UI

**技术要点**:
- 复用现有 Mem0/Qdrant 集成
- 集成 `langchain_community.document_loaders`

### 4.4 Phase 4: Trace 模块（1-2 周）

**任务列表**:
1. 自定义 CallbackHandler
2. LangSmith 集成（可选）
3. Langfuse 集成（可选）
4. 本地 Trace 存储
5. 实时 Trace 流
6. Trace Dashboard UI

**技术要点**:
- 使用 `langchain.callbacks`
- 实现异步 Trace 收集

## 5. 依赖列表

### 5.1 Python 依赖

```txt
# Core
langchain>=0.3.0
langchain-core>=0.3.0
langchain-community>=0.3.0

# LLM Providers
langchain-openai>=0.2.0
langchain-ollama>=0.2.0

# Tools
langchainhub>=0.1.0

# RAG
langchain-text-splitters>=0.3.0
langchain-qdrant>=0.2.0

# Trace (Optional)
langsmith>=0.1.0
langfuse>=2.0.0
```

### 5.2 前端依赖

```json
{
  "@langchain/core": "^0.3.0",
  "langsmith": "^0.1.0"
}
```

## 6. 数据结构

### 6.1 Tool 定义

```python
class LangChainToolConfig(BaseModel):
    name: str
    description: str
    tool_type: Literal["builtin", "custom", "langchain"]
    # LangChain 特定配置
    langchain_import: Optional[str] = None  # 如 "langchain_community.tools.shell.tool"
    args_schema: Optional[Dict] = None
    # 执行配置
    execution_config: Dict = {}
    # 是否启用回调
    callbacks: List[str] = []
```

### 6.2 Skill 定义

```python
class SkillDefinition(BaseModel):
    id: str
    name: str
    description: str
    version: str
    # LCEL Chain 定义
    chain_config: Dict  # LCEL 表达式或组件配置
    # 输入输出 Schema
    input_schema: Dict
    output_schema: Dict
    # 依赖的其他 Skills/Tools
    dependencies: List[str] = []
    # 元数据
    metadata: Dict = {}
```

### 6.3 RAG 配置

```python
class RAGConfiguration(BaseModel):
    # 文档加载配置
    document_loader: Dict  # 加载器类型和配置
    # 切分策略
    text_splitter: Dict    # 如 {"type": "recursive", "chunk_size": 1000}
    # Embedding 配置
    embedding: Dict        # {"provider": "openai", "model": "text-embedding-3-small"}
    # Vector Store 配置
    vectorstore: Dict      # 复用现有 Qdrant 配置
    # 检索配置
    retriever: Dict        # {"search_type": "mmr", "k": 5}
    # RAG Chain 配置
    chain_type: str = "stuff"  # stuff/map_reduce/refine
```

### 6.4 Trace 配置

```python
class TraceConfiguration(BaseModel):
    # 启用状态
    enabled: bool = True
    # 本地存储配置
    local_storage: Dict = {
        "enabled": True,
        "path": "./data/traces",
        "retention_days": 30
    }
    # LangSmith 配置（可选）
    langsmith: Optional[Dict] = {
        "enabled": False,
        "api_key": "",
        "project_name": "cowork"
    }
    # Langfuse 配置（可选）
    langfuse: Optional[Dict] = {
        "enabled": False,
        "host": "",
        "public_key": "",
        "secret_key": ""
    }
    # 实时推送配置
    realtime: Dict = {
        "enabled": True,
        "websocket_endpoint": "/ws/trace"
    }
```

## 7. API 设计

### 7.1 Tools API

```yaml
# 注册 LangChain Tool
POST /api/langchain/tools
{
  "name": "shell",
  "description": "Execute shell commands",
  "tool_type": "langchain",
  "langchain_import": "langchain_community.tools.shell.tool",
  "args_schema": {...}
}

# 获取可用 Tools
GET /api/langchain/tools?type=all|builtin|custom|langchain

# 执行 Tool
POST /api/langchain/tools/{tool_name}/invoke
{
  "input": "...",
  "config": {...}
}

# Tool Streaming 执行
POST /api/langchain/tools/{tool_name}/stream
```

### 7.2 Skills API

```yaml
# 创建 Skill
POST /api/langchain/skills
{
  "name": "data_analysis",
  "description": "Analyze data and generate insights",
  "chain_config": {
    "type": "lcel",
    "expression": "..."
  },
  "input_schema": {...},
  "output_schema": {...}
}

# 执行 Skill
POST /api/langchain/skills/{skill_id}/invoke

# 导出/导入 Skill
GET /api/langchain/skills/{skill_id}/export
POST /api/langchain/skills/import
```

### 7.3 RAG API

```yaml
# 创建 RAG 配置
POST /api/langchain/rag/configs
{
  "name": "knowledge_base",
  "document_loader": {...},
  "text_splitter": {...},
  "embedding": {...},
  "vectorstore": {...},
  "retriever": {...}
}

# 上传文档
POST /api/langchain/rag/documents
Content-Type: multipart/form-data

# 检索
POST /api/langchain/rag/retrieve
{
  "config_id": "...",
  "query": "...",
  "top_k": 5
}

# RAG Chain 问答
POST /api/langchain/rag/ask
{
  "config_id": "...",
  "question": "...",
  "streaming": true
}
```

### 7.4 Trace API

```yaml
# 获取 Trace 配置
GET /api/langchain/trace/config

# 更新配置
PUT /api/langchain/trace/config

# 查询 Traces
GET /api/langchain/traces?session_id=...&agent_id=...

# 获取单个 Trace 详情
GET /api/langchain/traces/{trace_id}

# WebSocket 实时 Trace
WS /ws/trace
```

## 8. 数据模型

### 8.1 数据库表设计（扩展现有）

```sql
-- LangChain Tools 配置表
CREATE TABLE lc_tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    tool_type VARCHAR(50) NOT NULL, -- builtin, custom, langchain
    langchain_import VARCHAR(255),
    args_schema JSONB,
    execution_config JSONB DEFAULT '{}',
    callbacks JSONB DEFAULT '[]',
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- LangChain Skills 表
CREATE TABLE lc_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    version VARCHAR(50) NOT NULL,
    chain_config JSONB NOT NULL,
    input_schema JSONB,
    output_schema JSONB,
    dependencies JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- RAG 配置表
CREATE TABLE lc_rag_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    document_loader JSONB,
    text_splitter JSONB,
    embedding JSONB,
    vectorstore JSONB,
    retriever JSONB,
    chain_type VARCHAR(50) DEFAULT 'stuff',
    metadata JSONB DEFAULT '{}',
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- RAG 文档表
CREATE TABLE lc_rag_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID REFERENCES lc_rag_configs(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    file_path VARCHAR(500),
    file_type VARCHAR(50),
    file_size BIGINT,
    chunk_count INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'pending', -- pending, processing, completed, error
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- Trace 记录表
CREATE TABLE lc_traces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id VARCHAR(255) NOT NULL,
    parent_id VARCHAR(255),
    session_id VARCHAR(255),
    agent_id VARCHAR(255),
    run_type VARCHAR(50), -- llm, chain, tool, retriever
    name VARCHAR(255),
    inputs JSONB,
    outputs JSONB,
    error TEXT,
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    latency_ms INTEGER,
    token_usage JSONB,
    cost_usd DECIMAL(10,8),
    tags JSONB,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Trace 配置表
CREATE TABLE lc_trace_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enabled BOOLEAN DEFAULT true,
    local_storage JSONB,
    langsmith JSONB,
    langfuse JSONB,
    realtime JSONB,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 创建索引
CREATE INDEX idx_lc_tools_name ON lc_tools(name);
CREATE INDEX idx_lc_skills_name ON lc_skills(name);
CREATE INDEX idx_lc_rag_configs_name ON lc_rag_configs(name);
CREATE INDEX idx_lc_rag_docs_config ON lc_rag_documents(config_id);
CREATE INDEX idx_lc_traces_session ON lc_traces(session_id);
CREATE INDEX idx_lc_traces_agent ON lc_traces(agent_id);
CREATE INDEX idx_lc_traces_time ON lc_traces(start_time DESC);
```

## 9. 接口设计

### 9.1 Python 接口

```python
# backend/app/services/langchain/__init__.py

from .tools import LangChainToolManager
from .skills import SkillOrchestrator
from .rag import RAGManager
from .trace import TraceManager
from .llm import LLMProvider

__all__ = [
    "LangChainToolManager",
    "SkillOrchestrator",
    "RAGManager",
    "TraceManager",
    "LLMProvider",
]
```

```python
# backend/app/services/langchain/base.py

from abc import ABC, abstractmethod
from typing import Any, AsyncIterator, Dict, Optional
from langchain_core.runnables import Runnable
from langchain_core.callbacks import Callbacks

class BaseLangChainService(ABC):
    """LangChain 服务基类"""

    @abstractmethod
    async def initialize(self) -> None:
        """初始化服务"""
        pass

    @abstractmethod
    async def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        pass
```

```python
# backend/app/services/langchain/tools.py

from typing import List, Optional, Dict, Any, Type
from langchain_core.tools import BaseTool, Tool
from langchain.tools import tool as tool_decorator
from langchain_community.tools import (
    ShellTool,
    WikipediaQueryRun,
    DuckDuckGoSearchRun,
)

class LangChainToolManager:
    """LangChain Tool 管理器"""

    def __init__(self):
        self._tools: Dict[str, BaseTool] = {}
        self._custom_tools: Dict[str, Type[BaseTool]] = {}

    async def initialize(self):
        """初始化内置 Tools"""
        # 注册常用 LangChain Tools
        self._tools["shell"] = ShellTool()
        self._tools["wikipedia"] = WikipediaQueryRun()
        self._tools["duckduckgo"] = DuckDuckGoSearchRun()

    def register_tool(self, name: str, tool: BaseTool) -> None:
        """注册 Tool"""
        self._tools[name] = tool

    def register_custom_tool(
        self,
        name: str,
        func: callable,
        description: str,
        args_schema: Optional[Type] = None
    ) -> None:
        """注册自定义 Tool"""
        tool = Tool.from_function(
            func=func,
            name=name,
            description=description,
            args_schema=args_schema,
        )
        self._tools[name] = tool

    def get_tool(self, name: str) -> Optional[BaseTool]:
        """获取 Tool"""
        return self._tools.get(name)

    def list_tools(self) -> List[Dict[str, Any]]:
        """列出所有 Tools"""
        return [
            {
                "name": name,
                "description": tool.description,
                "args_schema": tool.args_schema.model_json_schema() if tool.args_schema else None,
            }
            for name, tool in self._tools.items()
        ]

    async def invoke(
        self,
        tool_name: str,
        input_data: Dict[str, Any],
        callbacks: Optional[List] = None
    ) -> Any:
        """执行 Tool"""
        tool = self.get_tool(tool_name)
        if not tool:
            raise ValueError(f"Tool {tool_name} not found")

        return await tool.ainvoke(input_data, config={"callbacks": callbacks})
```

```python
# backend/app/services/langchain/skills.py

from typing import Dict, List, Optional, Any, AsyncIterator
from langchain_core.runnables import Runnable, RunnableConfig
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_openai import ChatOpenAI

class SkillOrchestrator:
    """Skill 编排器 - 基于 LCEL"""

    def __init__(self, llm_provider):
        self.llm_provider = llm_provider
        self._skills: Dict[str, Runnable] = {}
        self._templates: Dict[str, ChatPromptTemplate] = {}

    async def initialize(self):
        """初始化内置 Skill 模板"""
        # 注册常用模板
        self._templates["qa"] = ChatPromptTemplate.from_messages([
            ("system", "You are a helpful assistant. Use the following context to answer the question."),
            ("human", "Context: {context}\n\nQuestion: {question}")
        ])

        self._templates["summarize"] = ChatPromptTemplate.from_messages([
            ("system", "Summarize the following text concisely."),
            ("human", "{text}")
        ])

    def create_skill(
        self,
        name: str,
        prompt_template: ChatPromptTemplate,
        output_parser = None,
        tools: Optional[List] = None
    ) -> Runnable:
        """创建 LCEL Skill"""
        llm = self.llm_provider.get_llm()

        chain = prompt_template | llm

        if output_parser:
            chain = chain | output_parser

        if tools:
            # 绑定 Tools
            chain = chain.bind(tools=tools)

        self._skills[name] = chain
        return chain

    def get_skill(self, name: str) -> Optional[Runnable]:
        """获取 Skill"""
        return self._skills.get(name)

    async def invoke(
        self,
        skill_name: str,
        input_data: Dict[str, Any],
        config: Optional[RunnableConfig] = None
    ) -> Any:
        """执行 Skill"""
        skill = self.get_skill(skill_name)
        if not skill:
            raise ValueError(f"Skill {skill_name} not found")

        return await skill.ainvoke(input_data, config=config)

    async def stream(
        self,
        skill_name: str,
        input_data: Dict[str, Any],
        config: Optional[RunnableConfig] = None
    ) -> AsyncIterator[Any]:
        """流式执行 Skill"""
        skill = self.get_skill(skill_name)
        if not skill:
            raise ValueError(f"Skill {skill_name} not found")

        async for chunk in skill.astream(input_data, config=config):
            yield chunk
```

```python
# backend/app/services/langchain/rag.py

from typing import Dict, List, Optional, Any, AsyncIterator
from langchain_core.runnables import Runnable
from langchain_core.vectorstores import VectorStoreRetriever
from langchain_core.documents import Document
from langchain.chains import RetrievalQA
from langchain.chains.retrieval import create_retrieval_chain
from langchain.chains.combine_documents import create_stuff_documents_chain

class RAGManager:
    """RAG 管理器"""

    def __init__(self, llm_provider, embedding_provider):
        self.llm_provider = llm_provider
        self.embedding_provider = embedding_provider
        self._configs: Dict[str, Dict] = {}
        self._retrievers: Dict[str, VectorStoreRetriever] = {}

    async def initialize(self):
        """初始化"""
        pass

    def create_config(self, config_id: str, config: Dict) -> Dict:
        """创建 RAG 配置"""
        self._configs[config_id] = config
        return config

    async def process_document(
        self,
        config_id: str,
        file_path: str,
        metadata: Optional[Dict] = None
    ) -> Dict:
        """处理文档"""
        # 1. 加载文档
        # 2. 切分
        # 3. Embedding
        # 4. 存入 Vector Store
        pass

    async def retrieve(
        self,
        config_id: str,
        query: str,
        top_k: int = 5,
        search_type: str = "similarity"
    ) -> List[Document]:
        """检索文档"""
        retriever = self._retrievers.get(config_id)
        if not retriever:
            raise ValueError(f"RAG config {config_id} not found")

        return await retriever.aretrieve(query)

    async def ask(
        self,
        config_id: str,
        question: str,
        streaming: bool = False
    ) -> Any:
        """RAG 问答"""
        llm = self.llm_provider.get_llm()
        retriever = self._retrievers.get(config_id)

        # 创建 RAG Chain
        qa_chain = RetrievalQA.from_chain_type(
            llm=llm,
            chain_type="stuff",
            retriever=retriever
        )

        return await qa_chain.ainvoke({"query": question})
```

```python
# backend/app/services/langchain/trace.py

import json
import asyncio
from typing import Dict, List, Optional, Any
from datetime import datetime
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult
from langchain_core.agents import AgentAction, AgentFinish

class TraceCallbackHandler(BaseCallbackHandler):
    """Trace 回调处理器"""

    def __init__(self, trace_manager, session_id: str, agent_id: str):
        self.trace_manager = trace_manager
        self.session_id = session_id
        self.agent_id = agent_id
        self.trace_stack: List[Dict] = []

    def _create_trace(self, run_type: str, name: str, inputs: Dict) -> str:
        """创建 Trace 记录"""
        trace_id = f"{self.session_id}_{datetime.now().timestamp()}"
        trace_data = {
            "trace_id": trace_id,
            "parent_id": self.trace_stack[-1]["trace_id"] if self.trace_stack else None,
            "session_id": self.session_id,
            "agent_id": self.agent_id,
            "run_type": run_type,
            "name": name,
            "inputs": inputs,
            "start_time": datetime.now(),
        }
        self.trace_stack.append(trace_data)
        return trace_id

    def _end_trace(self, outputs: Any = None, error: str = None):
        """结束 Trace 记录"""
        if not self.trace_stack:
            return

        trace_data = self.trace_stack.pop()
        trace_data["end_time"] = datetime.now()
        trace_data["outputs"] = outputs
        trace_data["error"] = error

        # 计算延迟
        if trace_data.get("start_time"):
            delta = trace_data["end_time"] - trace_data["start_time"]
            trace_data["latency_ms"] = int(delta.total_seconds() * 1000)

        # 异步保存
        asyncio.create_task(
            self.trace_manager.save_trace(trace_data)
        )

    # ===== LLM Callbacks =====
    def on_llm_start(self, serialized: Dict[str, Any], prompts: List[str], **kwargs):
        self._create_trace("llm", serialized.get("name", "llm"), {"prompts": prompts})

    def on_llm_end(self, response: LLMResult, **kwargs):
        outputs = {
            "generations": [[g.text for g in gen] for gen in response.generations],
            "token_usage": response.llm_output.get("token_usage") if response.llm_output else None
        }
        self._end_trace(outputs=outputs)

    def on_llm_error(self, error: Exception, **kwargs):
        self._end_trace(error=str(error))

    # ===== Chain Callbacks =====
    def on_chain_start(self, serialized: Dict[str, Any], inputs: Dict[str, Any], **kwargs):
        self._create_trace("chain", serialized.get("name", "chain"), inputs)

    def on_chain_end(self, outputs: Dict[str, Any], **kwargs):
        self._end_trace(outputs=outputs)

    def on_chain_error(self, error: Exception, **kwargs):
        self._end_trace(error=str(error))

    # ===== Tool Callbacks =====
    def on_tool_start(self, serialized: Dict[str, Any], input_str: str, **kwargs):
        self._create_trace("tool", serialized.get("name", "tool"), {"input": input_str})

    def on_tool_end(self, output: str, **kwargs):
        self._end_trace(outputs={"output": output})

    def on_tool_error(self, error: Exception, **kwargs):
        self._end_trace(error=str(error))

    # ===== Retriever Callbacks =====
    def on_retriever_start(self, serialized: Dict[str, Any], query: str, **kwargs):
        self._create_trace("retriever", serialized.get("name", "retriever"), {"query": query})

    def on_retriever_end(self, documents: List[Any], **kwargs):
        outputs = {"document_count": len(documents), "documents": [{"page_content": d.page_content, "metadata": d.metadata} for d in documents]}
        self._end_trace(outputs=outputs)

    def on_retriever_error(self, error: Exception, **kwargs):
        self._end_trace(error=str(error))


class TraceManager:
    """Trace 管理器"""

    def __init__(self, config: Dict):
        self.config = config
        self.local_storage = None
        self.langsmith_client = None
        self.langfuse_client = None

    async def initialize(self):
        """初始化 Trace 管理器"""
        # 初始化本地存储
        if self.config.get("local_storage", {}).get("enabled"):
            # 初始化本地存储
            pass

        # 初始化 LangSmith
        if self.config.get("langsmith", {}).get("enabled"):
            from langsmith import Client
            self.langsmith_client = Client(
                api_key=self.config["langsmith"]["api_key"]
            )

        # 初始化 Langfuse
        if self.config.get("langfuse", {}).get("enabled"):
            from langfuse import Langfuse
            self.langfuse_client = Langfuse(
                host=self.config["langfuse"]["host"],
                public_key=self.config["langfuse"]["public_key"],
                secret_key=self.config["langfuse"]["secret_key"]
            )

    async def save_trace(self, trace_data: Dict):
        """保存 Trace 记录"""
        # 本地存储
        if self.local_storage:
            await self._save_local(trace_data)

        # LangSmith
        if self.langsmith_client:
            await self._send_langsmith(trace_data)

        # Langfuse
        if self.langfuse_client:
            await self._send_langfuse(trace_data)

    async def _save_local(self, trace_data: Dict):
        """保存到本地"""
        # 实现本地存储逻辑
        pass

    async def _send_langsmith(self, trace_data: Dict):
        """发送到 LangSmith"""
        # 实现 LangSmith 发送逻辑
        pass

    async def _send_langfuse(self, trace_data: Dict):
        """发送到 Langfuse"""
        # 实现 Langfuse 发送逻辑
        pass

    def get_callback_handler(
        self,
        session_id: str,
        agent_id: str
    ) -> TraceCallbackHandler:
        """获取 Trace 回调处理器"""
        return TraceCallbackHandler(self, session_id, agent_id)

    async def query_traces(
        self,
        session_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        run_type: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict]:
        """查询 Trace 记录"""
        # 实现查询逻辑
        pass
```

## 10. 实施路线图

### Phase 1: 基础设施（Week 1）
- [ ] 搭建 LangChain Python 依赖
- [ ] 创建基础服务框架
- [ ] 实现 LLM Provider 适配
- [ ] 数据库表迁移

### Phase 2: Tools 模块（Week 2-3）
- [ ] 实现 LangChainToolManager
- [ ] 集成常用 Tools
- [ ] 自定义 Tool 框架
- [ ] API 端点实现
- [ ] 前端 Tool 配置 UI

### Phase 3: Skills 模块（Week 4-5）
- [ ] 实现 SkillOrchestrator
- [ ] LCEL 集成
- [ ] Skill DSL 设计
- [ ] Chain 模板库
- [ ] 前端 Skill 编排 UI

### Phase 4: RAG 模块（Week 6-8）
- [ ] 文档加载器集成
- [ ] Chunking 策略
- [ ] Embedding 管理
- [ ] Vector Store 适配
- [ ] RAG Chain 实现
- [ ] 前端 RAG 配置 UI

### Phase 5: Trace 模块（Week 9-10）
- [ ] 实现 TraceCallbackHandler
- [ ] 本地 Trace 存储
- [ ] LangSmith/Langfuse 集成
- [ ] WebSocket 实时推送
- [ ] 前端 Trace Dashboard

## 11. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|-----|------|------|----------|
| LangChain API 变更 | 中 | 高 | 封装适配层，隔离变动 |
| 性能瓶颈 | 中 | 高 | 异步化，Streaming，缓存 |
| 依赖冲突 | 低 | 中 | 虚拟环境隔离，依赖锁定 |
| 学习曲线 | 中 | 低 | 文档，示例，培训 |

## 12. 附录

### 12.1 参考文档
- [LangChain Documentation](https://python.langchain.com/)
- [LangChain Core API](https://api.python.langchain.com/)
- [LCEL Guide](https://python.langchain.com/docs/expression_language/)
- [LangSmith Documentation](https://docs.smith.langchain.com/)

### 12.2 相关 Issue
- 待创建...

---

**文档版本**: 1.0
**最后更新**: 2026-04-17
**作者**: AI Assistant
