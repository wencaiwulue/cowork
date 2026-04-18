"""
LangChain 服务基类模块
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, AsyncIterator, Optional


class BaseLangChainService(ABC):
    """
    LangChain 服务基类

    所有 LangChain 模块服务都需要继承此类
    """

    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self._initialized = False

    @abstractmethod
    async def initialize(self) -> None:
        """
        初始化服务

        子类需要实现具体的初始化逻辑
        """
        self._initialized = True

    @abstractmethod
    async def health_check(self) -> Dict[str, Any]:
        """
        健康检查

        Returns:
            Dict 包含状态信息
        """
        return {
            "initialized": self._initialized,
            "status": "healthy" if self._initialized else "not_initialized"
        }

    async def shutdown(self) -> None:
        """
        关闭服务

        子类可以重写以清理资源
        """
        self._initialized = False


class StreamingMixin:
    """
    Streaming 支持混入类

    为服务提供流式输出能力
    """

    async def stream(
        self,
        input_data: Dict[str, Any],
        config: Optional[Dict] = None
    ) -> AsyncIterator[Any]:
        """
        流式执行

        Args:
            input_data: 输入数据
            config: 配置选项

        Yields:
            流式输出块
        """
        raise NotImplementedError("子类需要实现 stream 方法")


class CallbackMixin:
    """
    Callback 支持混入类

    为服务提供回调能力，用于 Trace 和监控
    """

    def __init__(self):
        self._callbacks: list = []

    def add_callback(self, callback):
        """添加回调"""
        self._callbacks.append(callback)

    def remove_callback(self, callback):
        """移除回调"""
        if callback in self._callbacks:
            self._callbacks.remove(callback)

    def get_callbacks(self) -> list:
        """获取所有回调"""
        return self._callbacks.copy()
