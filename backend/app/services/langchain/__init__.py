"""
LangChain 全家桶集成模块

提供 Tools、Skills、RAG、Trace 等核心能力
"""

# 基础模块
from .base import BaseLangChainService, StreamingMixin, CallbackMixin

# 核心模块（按依赖顺序）
from .llm import LLMProvider
from .trace import TraceManager, TraceCallbackHandler, TraceRecord, RunType
from .tools import LangChainToolManager, ToolConfig
from .skills import SkillOrchestrator, SkillDefinition
from .rag import RAGManager, RAGConfiguration

__version__ = "0.1.0"

__all__ = [
    # 基础
    "BaseLangChainService",
    "StreamingMixin",
    "CallbackMixin",

    # 核心服务
    "LLMProvider",
    "LangChainToolManager",
    "SkillOrchestrator",
    "RAGManager",
    "TraceManager",

    # 核心类
    "ToolConfig",
    "SkillDefinition",
    "RAGConfiguration",
    "TraceCallbackHandler",
    "TraceRecord",
    "RunType",

    # 主服务类
    "LangChainService",
]


class LangChainService:
    """
    LangChain 服务主类

    统一管理 Tools、Skills、RAG、Trace 等模块
    """

    def __init__(self, config: dict = None):
        self.config = config or {}
        self._initialized = False

        # 子服务实例
        self.llm_provider: LLMProvider = None
        self.tool_manager: LangChainToolManager = None
        self.skill_orchestrator: SkillOrchestrator = None
        self.rag_manager: RAGManager = None
        self.trace_manager: TraceManager = None

    async def initialize(self):
        """初始化所有服务"""
        if self._initialized:
            return

        # 1. 初始化 LLM Provider
        self.llm_provider = LLMProvider(self.config.get("llm", {}))
        await self.llm_provider.initialize()

        # 2. 初始化 Trace Manager（最先初始化以捕获其他服务的 Trace）
        self.trace_manager = TraceManager(self.config.get("trace", {}))
        await self.trace_manager.initialize()

        # 3. 初始化 Tool Manager
        self.tool_manager = LangChainToolManager()
        await self.tool_manager.initialize()

        # 4. 初始化 Skill Orchestrator
        self.skill_orchestrator = SkillOrchestrator(self.llm_provider)
        await self.skill_orchestrator.initialize()

        # 5. 初始化 RAG Manager
        # 使用 LLM Provider 作为 Embedding Provider（如果需要分开配置，可以修改）
        self.rag_manager = RAGManager(self.llm_provider, self.llm_provider)
        await self.rag_manager.initialize()

        self._initialized = True

    async def health_check(self) -> dict:
        """健康检查"""
        return {
            "initialized": self._initialized,
            "llm_provider": await self.llm_provider.health_check() if self.llm_provider else None,
            "tool_manager": len(self.tool_manager._tools) if self.tool_manager else 0,
            "skill_orchestrator": len(self.skill_orchestrator._skills) if self.skill_orchestrator else 0,
            "rag_manager": len(self.rag_manager._configs) if self.rag_manager else 0,
            "trace_manager": self.trace_manager.config if self.trace_manager else None,
        }

    async def shutdown(self):
        """关闭服务"""
        self._initialized = False

        # 关闭各个管理器
        if self.trace_manager:
            await self.trace_manager.shutdown()

        # 清理资源
        if self.llm_provider:
            self.llm_provider.clear_cache()
