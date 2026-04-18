"""
Trace 模块 - 可观测性和调试

提供完整的 Trace 能力，包括回调处理、存储和可视化
"""

import json
import asyncio
import uuid
from typing import Dict, Any, Optional, List, AsyncIterator, Union
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field

from langchain_core.callbacks import BaseCallbackHandler, AsyncCallbackHandler
from langchain_core.outputs import LLMResult, ChatResult, Generation, ChatGeneration
from langchain_core.agents import AgentAction, AgentFinish
from langchain_core.messages import BaseMessage
from langchain_core.documents import Document


class RunType(str, Enum):
    """运行类型"""
    LLM = "llm"
    CHAIN = "chain"
    TOOL = "tool"
    RETRIEVER = "retriever"
    AGENT = "agent"
    PROMPT = "prompt"
    PARSER = "parser"
    EMBEDDING = "embedding"


class TraceStatus(str, Enum):
    """Trace 状态"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    ERROR = "error"
    CANCELLED = "cancelled"


class TokenUsage(BaseModel):
    """Token 使用情况"""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class TraceRecord(BaseModel):
    """
    Trace 记录

    单个运行单元的完整追踪信息
    """
    # 标识信息
    trace_id: str
    parent_id: Optional[str] = None
    root_id: Optional[str] = None

    # 运行信息
    run_type: RunType
    name: str
    status: TraceStatus = TraceStatus.PENDING

    # 关联信息
    session_id: Optional[str] = None
    agent_id: Optional[str] = None
    user_id: Optional[str] = None

    # 输入输出
    inputs: Dict[str, Any] = Field(default_factory=dict)
    outputs: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None

    # 时间信息
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    latency_ms: Optional[int] = None

    # Token 和成本
    token_usage: Optional[TokenUsage] = None
    cost_usd: Optional[float] = None

    # 额外信息
    tags: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    # 子 Trace
    children: List[str] = Field(default_factory=list)

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class TraceConfig(BaseModel):
    """Trace 配置"""
    enabled: bool = True

    # 本地存储配置
    local_storage: Dict[str, Any] = Field(default_factory=lambda: {
        "enabled": True,
        "path": "./data/traces",
        "retention_days": 30,
        "max_traces": 10000,
    })

    # LangSmith 配置
    langsmith: Dict[str, Any] = Field(default_factory=lambda: {
        "enabled": False,
        "api_key": None,
        "project_name": "cowork",
        "endpoint": "https://api.smith.langchain.com",
    })

    # Langfuse 配置
    langfuse: Dict[str, Any] = Field(default_factory=lambda: {
        "enabled": False,
        "host": None,
        "public_key": None,
        "secret_key": None,
    })

    # 实时推送配置
    realtime: Dict[str, Any] = Field(default_factory=lambda: {
        "enabled": True,
        "websocket_endpoint": "/ws/trace",
        "batch_size": 10,
        "flush_interval_ms": 1000,
    })

    # 采样配置
    sampling: Dict[str, Any] = Field(default_factory=lambda: {
        "enabled": False,
        "rate": 1.0,  # 1.0 = 100%
    })


class TraceCallbackHandler(AsyncCallbackHandler):
    """
    Trace 回调处理器

    捕获 LangChain 运行时的各类事件并生成 Trace 记录
    """

    def __init__(
        self,
        trace_manager: "TraceManager",
        session_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        user_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        self.trace_manager = trace_manager
        self.session_id = session_id
        self.agent_id = agent_id
        self.user_id = user_id
        self.tags = tags or []
        self.base_metadata = metadata or {}

        # 运行栈 - 用于跟踪嵌套运行
        self._run_stack: List[TraceRecord] = []
        self._root_id: Optional[str] = None

    def _create_trace(
        self,
        run_type: RunType,
        name: str,
        inputs: Dict[str, Any],
        parent_id: Optional[str] = None,
    ) -> TraceRecord:
        """创建 Trace 记录"""
        trace_id = str(uuid.uuid4())

        if self._root_id is None:
            self._root_id = trace_id

        record = TraceRecord(
            trace_id=trace_id,
            parent_id=parent_id,
            root_id=self._root_id,
            run_type=run_type,
            name=name,
            status=TraceStatus.RUNNING,
            session_id=self.session_id,
            agent_id=self.agent_id,
            user_id=self.user_id,
            inputs=inputs,
            start_time=datetime.now(),
            tags=self.tags,
            metadata=self.base_metadata.copy(),
        )

        # 保存记录
        self.trace_manager._save_trace(record)

        # 压入栈
        self._run_stack.append(record)

        return record

    def _end_trace(
        self,
        outputs: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None,
    ):
        """结束当前 Trace"""
        if not self._run_stack:
            return

        record = self._run_stack.pop()
        record.end_time = datetime.now()
        record.status = TraceStatus.ERROR if error else TraceStatus.COMPLETED

        if outputs:
            record.outputs = outputs
        if error:
            record.error = error

        # 计算延迟
        if record.start_time and record.end_time:
            delta = record.end_time - record.start_time
            record.latency_ms = int(delta.total_seconds() * 1000)

        # 更新记录
        self.trace_manager._save_trace(record)

    # ============= LLM Callbacks =============

    async def on_llm_start(
        self,
        serialized: Dict[str, Any],
        prompts: List[str],
        **kwargs: Any,
    ) -> None:
        """LLM 开始"""
        parent_id = self._run_stack[-1].trace_id if self._run_stack else None
        self._create_trace(
            run_type=RunType.LLM,
            name=serialized.get("name", "llm"),
            inputs={"prompts": prompts},
            parent_id=parent_id,
        )

    async def on_llm_end(
        self,
        response: LLMResult,
        **kwargs: Any,
    ) -> None:
        """LLM 结束"""
        outputs = {
            "generations": [
                [{"text": g.text, "generation_info": g.generation_info} for g in gen]
                for gen in response.generations
            ],
        }

        # Token 使用
        if response.llm_output:
            token_usage = response.llm_output.get("token_usage", {})
            outputs["token_usage"] = token_usage

        self._end_trace(outputs=outputs)

    async def on_llm_error(
        self,
        error: BaseException,
        **kwargs: Any,
    ) -> None:
        """LLM 错误"""
        self._end_trace(error=str(error))

    # ============= Chain Callbacks =============

    async def on_chain_start(
        self,
        serialized: Dict[str, Any],
        inputs: Dict[str, Any],
        **kwargs: Any,
    ) -> None:
        """Chain 开始"""
        parent_id = self._run_stack[-1].trace_id if self._run_stack else None
        self._create_trace(
            run_type=RunType.CHAIN,
            name=serialized.get("name", "chain"),
            inputs=inputs,
            parent_id=parent_id,
        )

    async def on_chain_end(
        self,
        outputs: Dict[str, Any],
        **kwargs: Any,
    ) -> None:
        """Chain 结束"""
        self._end_trace(outputs=outputs)

    async def on_chain_error(
        self,
        error: BaseException,
        **kwargs: Any,
    ) -> None:
        """Chain 错误"""
        self._end_trace(error=str(error))

    # ============= Tool Callbacks =============

    async def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        **kwargs: Any,
    ) -> None:
        """Tool 开始"""
        parent_id = self._run_stack[-1].trace_id if self._run_stack else None
        self._create_trace(
            run_type=RunType.TOOL,
            name=serialized.get("name", "tool"),
            inputs={"input": input_str},
            parent_id=parent_id,
        )

    async def on_tool_end(
        self,
        output: str,
        **kwargs: Any,
    ) -> None:
        """Tool 结束"""
        self._end_trace(outputs={"output": output})

    async def on_tool_error(
        self,
        error: BaseException,
        **kwargs: Any,
    ) -> None:
        """Tool 错误"""
        self._end_trace(error=str(error))

    # ============= Retriever Callbacks =============

    async def on_retriever_start(
        self,
        serialized: Dict[str, Any],
        query: str,
        **kwargs: Any,
    ) -> None:
        """Retriever 开始"""
        parent_id = self._run_stack[-1].trace_id if self._run_stack else None
        self._create_trace(
            run_type=RunType.RETRIEVER,
            name=serialized.get("name", "retriever"),
            inputs={"query": query},
            parent_id=parent_id,
        )

    async def on_retriever_end(
        self,
        documents: List[Document],
        **kwargs: Any,
    ) -> None:
        """Retriever 结束"""
        outputs = {
            "document_count": len(documents),
            "documents": [
                {
                    "page_content": doc.page_content[:500] + "..." if len(doc.page_content) > 500 else doc.page_content,
                    "metadata": doc.metadata,
                }
                for doc in documents
            ],
        }
        self._end_trace(outputs=outputs)

    async def on_retriever_error(
        self,
        error: BaseException,
        **kwargs: Any,
    ) -> None:
        """Retriever 错误"""
        self._end_trace(error=str(error))


class TraceManager:
    """
    Trace 管理器

    统一管理 Trace 的存储、查询和推送
    """

    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self._trace_config: Optional[TraceConfig] = None

        # 存储
        self._traces: Dict[str, TraceRecord] = {}
        self._pending_traces: List[TraceRecord] = []

        # 外部客户端
        self._langsmith_client = None
        self._langfuse_client = None

        # 监听器
        self._listeners: List[Callable[[TraceRecord], None]] = []

    async def initialize(self):
        """初始化 Trace 管理器"""
        self._trace_config = TraceConfig(**self.config)

        # 初始化 LangSmith
        if self._trace_config.langsmith.get("enabled"):
            await self._init_langsmith()

        # 初始化 Langfuse
        if self._trace_config.langfuse.get("enabled"):
            await self._init_langfuse()

        # 启动后台刷新任务
        if self._trace_config.realtime.get("enabled"):
            asyncio.create_task(self._flush_loop())

    async def _init_langsmith(self):
        """初始化 LangSmith 客户端"""
        try:
            from langsmith import Client
            self._langsmith_client = Client(
                api_key=self._trace_config.langsmith.get("api_key"),
                api_url=self._trace_config.langsmith.get("endpoint"),
            )
        except ImportError:
            print("Warning: langsmith not installed, skipping LangSmith integration")

    async def _init_langfuse(self):
        """初始化 Langfuse 客户端"""
        try:
            from langfuse import Langfuse
            self._langfuse_client = Langfuse(
                host=self._trace_config.langfuse.get("host"),
                public_key=self._trace_config.langfuse.get("public_key"),
                secret_key=self._trace_config.langfuse.get("secret_key"),
            )
        except ImportError:
            print("Warning: langfuse not installed, skipping Langfuse integration")

    async def _flush_loop(self):
        """后台刷新循环"""
        flush_interval = self._trace_config.realtime.get("flush_interval_ms", 1000) / 1000
        batch_size = self._trace_config.realtime.get("batch_size", 10)

        while True:
            await asyncio.sleep(flush_interval)
            await self._flush_pending(batch_size)

    async def _flush_pending(self, batch_size: int = 10):
        """刷新待处理的 Traces"""
        if not self._pending_traces:
            return

        batch = self._pending_traces[:batch_size]
        self._pending_traces = self._pending_traces[batch_size:]

        # 发送给监听器
        for trace in batch:
            for listener in self._listeners:
                try:
                    listener(trace)
                except Exception:
                    pass

    def _save_trace(self, record: TraceRecord):
        """保存 Trace 记录"""
        # 存入内存
        self._traces[record.trace_id] = record

        # 加入待处理队列
        if self._trace_config and self._trace_config.realtime.get("enabled"):
            self._pending_traces.append(record)

        # 发送到外部系统
        asyncio.create_task(self._send_to_external(record))

    async def _send_to_external(self, record: TraceRecord):
        """发送到外部系统"""
        # LangSmith
        if self._langsmith_client:
            try:
                await self._send_to_langsmith(record)
            except Exception as e:
                print(f"Failed to send to LangSmith: {e}")

        # Langfuse
        if self._langfuse_client:
            try:
                await self._send_to_langfuse(record)
            except Exception as e:
                print(f"Failed to send to Langfuse: {e}")

    async def _send_to_langsmith(self, record: TraceRecord):
        """发送到 LangSmith"""
        # 实现 LangSmith 发送逻辑
        pass

    async def _send_to_langfuse(self, record: TraceRecord):
        """发送到 Langfuse"""
        # 实现 Langfuse 发送逻辑
        pass

    def get_callback_handler(
        self,
        session_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        user_id: Optional[str] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> TraceCallbackHandler:
        """
        获取 Trace 回调处理器

        Args:
            session_id: 会话 ID
            agent_id: Agent ID
            user_id: 用户 ID
            tags: 标签列表
            metadata: 元数据

        Returns:
            TraceCallbackHandler 实例
        """
        return TraceCallbackHandler(
            trace_manager=self,
            session_id=session_id,
            agent_id=agent_id,
            user_id=user_id,
            tags=tags or [],
            metadata=metadata or {},
        )

    def get_trace(self, trace_id: str) -> Optional[TraceRecord]:
        """获取 Trace 记录"""
        return self._traces.get(trace_id)

    def query_traces(
        self,
        session_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        run_type: Optional[RunType] = None,
        status: Optional[TraceStatus] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        tags: Optional[List[str]] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[TraceRecord]:
        """查询 Trace 记录"""
        results = list(self._traces.values())

        # 过滤条件
        if session_id:
            results = [r for r in results if r.session_id == session_id]
        if agent_id:
            results = [r for r in results if r.agent_id == agent_id]
        if run_type:
            results = [r for r in results if r.run_type == run_type]
        if status:
            results = [r for r in results if r.status == status]
        if start_time:
            results = [r for r in results if r.start_time and r.start_time >= start_time]
        if end_time:
            results = [r for r in results if r.start_time and r.start_time <= end_time]
        if tags:
            results = [r for r in results if any(t in r.tags for t in tags)]

        # 排序（按开始时间倒序）
        results.sort(key=lambda r: r.start_time or datetime.min, reverse=True)

        # 分页
        return results[offset:offset + limit]

    def get_trace_tree(self, root_id: str) -> Optional[Dict[str, Any]]:
        """获取 Trace 树"""
        root = self._traces.get(root_id)
        if not root:
            return None

        def build_tree(trace_id: str) -> Dict[str, Any]:
            trace = self._traces.get(trace_id)
            if not trace:
                return None

            node = {
                **trace.model_dump(),
                "children": [build_tree(child_id) for child_id in trace.children]
            }
            return node

        return build_tree(root_id)

    def add_listener(self, callback: callable):
        """添加 Trace 监听器"""
        self._listeners.append(callback)

    def remove_listener(self, callback: callable):
        """移除 Trace 监听器"""
        if callback in self._listeners:
            self._listeners.remove(callback)

    async def shutdown(self):
        """关闭 Trace 管理器"""
        # 刷新剩余的 Traces
        await self._flush_pending(10000)

        # 关闭外部客户端
        if self._langsmith_client:
            # 关闭 LangSmith 客户端
            pass

        if self._langfuse_client:
            # 关闭 Langfuse 客户端
            pass

    def get_stats(self, session_id: Optional[str] = None) -> Dict[str, Any]:
        """获取 Trace 统计信息"""
        traces = list(self._traces.values())
        if session_id:
            traces = [t for t in traces if t.session_id == session_id]

        total_count = len(traces)
        completed_count = len([t for t in traces if t.status == TraceStatus.COMPLETED])
        error_count = len([t for t in traces if t.status == TraceStatus.ERROR])

        total_latency = sum([t.latency_ms for t in traces if t.latency_ms])
        avg_latency = total_latency / total_count if total_count > 0 else 0

        total_tokens = sum([
            t.token_usage.total_tokens for t in traces
            if t.token_usage and t.token_usage.total_tokens
        ])

        total_cost = sum([t.cost_usd for t in traces if t.cost_usd])

        return {
            "total_count": total_count,
            "completed_count": completed_count,
            "error_count": error_count,
            "success_rate": completed_count / total_count if total_count > 0 else 0,
            "avg_latency_ms": avg_latency,
            "total_tokens": total_tokens,
            "total_cost_usd": total_cost,
            "by_run_type": self._group_by_run_type(traces),
        }

    def _group_by_run_type(self, traces: List[TraceRecord]) -> Dict[str, Any]:
        """按运行类型分组统计"""
        groups = {}
        for run_type in RunType:
            type_traces = [t for t in traces if t.run_type == run_type]
            if type_traces:
                groups[run_type.value] = {
                    "count": len(type_traces),
                    "avg_latency_ms": sum([t.latency_ms for t in type_traces if t.latency_ms]) / len(type_traces),
                }
        return groups


# 避免循环引用，TraceCallbackHandler 已在此文件中定义
