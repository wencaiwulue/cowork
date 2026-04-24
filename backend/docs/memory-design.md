# Memory Module Design Document

## Overview

本系统采用**四层内存架构**，将不同用途的内存数据分层管理。设计的核心理念是：**mem0 (用户长期记忆)** 和 **LangGraph Checkpoint (执行检查点)** 是两种完全不同的技术，它们解决正交的问题，应该作为互补的技术共存。

---

## 核心概念对比

### mem0 vs LangGraph Checkpoint

| 特性 | mem0 (用户长期记忆) | LangGraph Checkpoint (执行检查点) |
|------|---------------------|-------------------------------------|
| **目的** | 存储用户信息、偏好、事实 | 保存/恢复工作流执行状态 |
| **范围** | 用户级别，跨所有会话 | 线程级别，单次执行 |
| **生命周期** | 永久，累积增长 | 临时，执行结束后可清理 |
| **数据结构** | 语义记忆（事实、偏好） | 执行状态（通道值、下一步节点） |
| **使用场景** | 个性化回复、记住用户偏好 | 错误恢复、断点续传、时间旅行 |
| **检索方式** | 语义搜索、相关事实检索 | 通过线程ID和检查点ID精确读取 |

### 类比理解

- **mem0** = 用户的大脑记忆，存储关于用户的一切信息
- **Checkpoint** = 程序的运行时堆栈，用于保存和恢复执行状态

---

## 四层架构设计

```
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 4: Long-Term Memory (Mem0-style User Memory)                  │
│ - Purpose: Extract and recall user facts across all sessions        │
│ - Lifetime: Permanent, user-scoped                                   │
│ - Use case: User preferences, personal info, accumulated knowledge  │
│ - Implementation: LongTermMemory (SQLite)                            │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 3: Store (Cross-Thread Shared Storage)                         │
│ - Purpose: Share data across different conversation threads         │
│ - Lifetime: Session/team scope                                        │
│ - Use case: Shared preferences, team settings, session context        │
│ - Implementation: SharedStore (SQLite, namespace-based)               │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 2: Checkpoint (Short-term Execution State)                     │
│ - Purpose: Save/restore LangGraph execution state                    │
│ - Lifetime: Single thread execution                                  │
│ - Use case: Resume interrupted workflows, error recovery             │
│ - Implementation: SQLiteCheckpointSaver (SQLite)                     │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 1: Conversation (Message History)                              │
│ - Purpose: Store conversation threads and messages                   │
│ - Lifetime: Per conversation thread                                  │
│ - Use case: Chat history, message retrieval                          │
│ - Implementation: ConversationMemory (SQLite)                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 各层详细说明

### Layer 1: Conversation Memory (对话历史)

```python
from app.services.memory import conversation_memory

# 创建会话线程
thread_id = conversation_memory.create_thread(agent_id="agent_123")

# 添加消息
conversation_memory.add_message(
    thread_id=thread_id,
    content="Hello!",
    role="user"
)

# 获取消息历史
messages = conversation_memory.get_messages(thread_id)
```

**数据表**:
- `threads`: 会话线程信息
- `messages`: 消息记录

---

### Layer 2: Checkpoint (执行检查点)

```python
from app.services.memory import checkpoint_store
from langgraph.graph import StateGraph

# 在 LangGraph 中使用
workflow = StateGraph(...)
# ... 定义工作流 ...

# 编译时传入 checkpoint saver
graph = workflow.compile(checkpointer=checkpoint_store)

# 执行时自动保存/恢复状态
config = {"configurable": {"thread_id": "thread_123"}}
result = graph.invoke(input_data, config=config)
```

**数据表**:
- `checkpoints`: 检查点数据
- `pending_writes`: 待写入操作

---

### Layer 3: Shared Store (跨线程共享存储)

```python
from app.services.memory import shared_store

# 存储共享数据
shared_store.put("team_prefs", "coding_style", {"language": "python"})
shared_store.put("team_prefs", "indentation", "spaces")

# 跨线程检索
style = shared_store.get("team_prefs", "coding_style")

# 列出命名空间
namespaces = shared_store.list_namespaces()

# 搜索键值
for key, value in shared_store.search("team_prefs"):
    print(f"{key}: {value}")
```

**数据表**:
- `store_items`: 键值对存储，复合主键 (namespace, key)

---

### Layer 4: Long-Term Memory (Mem0-style 用户长期记忆)

```python
from app.services.memory import long_term_memory

# 从对话中提取事实（简单规则版）
facts = long_term_memory.extract_facts_simple(
    user_id="user_123",
    conversation_text="I love Python programming and I'm allergic to peanuts."
)

# 使用 LLM 提取事实
facts = long_term_memory.extract_facts_with_llm(
    user_id="user_123",
    conversation_text="...",
    llm_client=openai_client
)

# 搜索相关记忆
relevant = long_term_memory.search(
    user_id="user_123",
    query="coding preferences",
    limit=5
)

# 手动添加事实
fact = long_term_memory.add(
    user_id="user_123",
    content="User prefers dark mode",
    category="preference",
    confidence=0.95
)
```

**数据表**:
- `facts`: 记忆事实表，包含内容、类别、置信度、访问统计等
- `metadata`: 系统元数据

**MemoryFact 数据结构**:
```python
@dataclass
class MemoryFact:
    id: str                    # 唯一ID
    user_id: str              # 用户ID
    content: str              # 事实内容
    category: str             # 类别: preference, fact, skill, constraint
    source: Optional[str]     # 来源
    confidence: float         # 置信度 0.0-1.0
    created_at: str           # 创建时间
    updated_at: str           # 更新时间
    access_count: int         # 访问次数
    last_accessed: str        # 最后访问时间
```

---

## 文件结构

```
app/services/memory/
├── __init__.py           # 模块导出、兼容层
├── conversation.py       # Layer 1: 对话历史
├── checkpoint.py         # Layer 2: 执行检查点
├── store.py              # Layer 3: 跨线程共享存储
└── long_term.py          # Layer 4: 用户长期记忆
```

**数据文件位置** (DATA_DIR 下):
- `conversations.db` - 对话历史
- `checkpoints.db` - 执行检查点
- `shared_store.db` - 共享存储
- `long_term_memory.db` - 长期记忆

---

## 设计原则

1. **单一职责**: 每层只负责一种类型的数据存储
2. **清晰边界**: 不同层之间不互相依赖
3. **持久化**: 所有层都使用 SQLite 保证数据持久化
4. **向后兼容**: 保留旧版 memory.py 的功能作为兼容层
5. **无外部依赖**: 不强制依赖 mem0 或 LangGraph，可独立使用

---

## 迁移指南

### 从旧版 memory.py 迁移

旧代码:
```python
from app.services.memory import get_memory_provider

memory = get_memory_provider(agent_id)
memory.add(text, user_id)
```

新代码 (等效):
```python
from app.services.memory import long_term_memory

# 直接添加到长期记忆
fact = long_term_memory.add(
    user_id=user_id,
    content=text,
    category="fact"
)
```

### 在 LangGraph 中使用 Checkpoint

```python
from app.services.memory import checkpoint_store
from langgraph.graph import StateGraph

workflow = StateGraph(...)
# ... 配置工作流 ...

# 使用 checkpoint store
graph = workflow.compile(checkpointer=checkpoint_store)
```

---

## 总结

本设计通过**四层架构**清晰划分了不同类型的内存数据:

1. **Conversation** - 对话历史，最基础的聊天记录
2. **Checkpoint** - 执行状态，用于恢复工作流执行
3. **Shared Store** - 跨线程共享数据，团队协作场景
4. **Long-Term Memory** - 用户长期记忆，个性化服务的基础

**mem0** 和 **LangGraph Checkpoint** 作为两种正交的技术，在本设计中作为独立的层共存，分别服务于"用户知识"和"执行状态"两个完全不同的领域。
