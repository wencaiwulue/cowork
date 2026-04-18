"""
LangChain Tools 管理模块

提供 Tools 的注册、管理和执行能力
"""

import importlib
import inspect
from typing import Dict, Any, Optional, List, Type, Callable
from pydantic import BaseModel, Field

from langchain_core.tools import BaseTool, Tool, StructuredTool
from langchain_community.tools import (
    ShellTool,
    DuckDuckGoSearchRun,
    WikipediaQueryRun,
)


class ToolConfig(BaseModel):
    """Tool 配置"""
    name: str = Field(..., description="Tool 名称")
    description: str = Field(..., description="Tool 描述")
    tool_type: str = Field(..., description="Tool 类型: builtin, custom, langchain, decorator")
    # LangChain 特定配置
    langchain_import: Optional[str] = Field(None, description="LangChain 导入路径")
    args_schema: Optional[Dict[str, Any]] = Field(None, description="参数 Schema")
    # 执行配置
    execution_config: Dict[str, Any] = Field(default_factory=dict)
    # 回调配置
    callbacks: List[str] = Field(default_factory=list)
    # 启用状态
    enabled: bool = True


class LangChainToolManager:
    """
    LangChain Tool 管理器

    统一管理 Tools 的注册、获取和执行
    """

    def __init__(self):
        self._tools: Dict[str, BaseTool] = {}
        self._configs: Dict[str, ToolConfig] = {}
        self._custom_tools: Dict[str, Callable] = {}

    async def initialize(self):
        """初始化内置 Tools"""
        # 注册常用 LangChain Tools
        await self._register_builtin_tools()

    async def _register_builtin_tools(self):
        """注册内置 Tools"""
        builtin_tools = [
            ("shell", ShellTool(), ToolConfig(
                name="shell",
                description="Execute shell commands",
                tool_type="builtin"
            )),
            ("duckduckgo", DuckDuckGoSearchRun(), ToolConfig(
                name="duckduckgo",
                description="Search the web using DuckDuckGo",
                tool_type="builtin"
            )),
            ("wikipedia", WikipediaQueryRun(), ToolConfig(
                name="wikipedia",
                description="Search Wikipedia articles",
                tool_type="builtin"
            )),
        ]

        for name, tool, config in builtin_tools:
            self._tools[name] = tool
            self._configs[name] = config

    def register_tool(self, config: ToolConfig, tool: Optional[BaseTool] = None) -> BaseTool:
        """
        注册 Tool

        Args:
            config: Tool 配置
            tool: 预创建的 Tool 实例（可选）

        Returns:
            注册的 Tool 实例
        """
        if tool is None:
            tool = self._create_tool_from_config(config)

        self._tools[config.name] = tool
        self._configs[config.name] = config

        return tool

    def _create_tool_from_config(self, config: ToolConfig) -> BaseTool:
        """从配置创建 Tool"""
        if config.tool_type == "langchain" and config.langchain_import:
            # 动态导入 LangChain Tool
            module_path, class_name = config.langchain_import.rsplit(".", 1)
            module = importlib.import_module(module_path)
            tool_class = getattr(module, class_name)
            return tool_class()

        elif config.tool_type == "custom":
            # 自定义 Tool 需要在注册时提供实现
            raise ValueError(f"Custom tool {config.name} must be registered with implementation")

        else:
            raise ValueError(f"Unsupported tool type: {config.tool_type}")

    def register_custom_tool(
        self,
        name: str,
        func: Callable,
        description: str,
        args_schema: Optional[Type[BaseModel]] = None
    ) -> BaseTool:
        """
        注册自定义 Tool

        Args:
            name: Tool 名称
            func: Tool 执行函数
            description: Tool 描述
            args_schema: 参数 Schema

        Returns:
            注册的 Tool 实例
        """
        tool = Tool.from_function(
            func=func,
            name=name,
            description=description,
            args_schema=args_schema,
        )

        config = ToolConfig(
            name=name,
            description=description,
            tool_type="custom"
        )

        self._tools[name] = tool
        self._configs[name] = config
        self._custom_tools[name] = func

        return tool

    def get_tool(self, name: str) -> Optional[BaseTool]:
        """
        获取 Tool

        Args:
            name: Tool 名称

        Returns:
            Tool 实例或 None
        """
        return self._tools.get(name)

    def get_config(self, name: str) -> Optional[ToolConfig]:
        """
        获取 Tool 配置

        Args:
            name: Tool 名称

        Returns:
            ToolConfig 或 None
        """
        return self._configs.get(name)

    def list_tools(self) -> List[Dict[str, Any]]:
        """
        列出所有 Tools

        Returns:
            Tool 列表
        """
        return [
            {
                "name": name,
                "description": config.description,
                "tool_type": config.tool_type,
                "enabled": config.enabled,
                "args_schema": tool.args_schema.model_json_schema() if tool.args_schema else None,
            }
            for name, tool in self._tools.items()
            for config in [self._configs.get(name, ToolConfig(name=name, description="", tool_type="unknown"))]
        ]

    async def invoke(
        self,
        tool_name: str,
        input_data: Any,
        callbacks: Optional[List] = None
    ) -> Any:
        """
        执行 Tool

        Args:
            tool_name: Tool 名称
            input_data: 输入数据
            callbacks: 回调列表

        Returns:
            Tool 执行结果
        """
        tool = self.get_tool(tool_name)
        if not tool:
            raise ValueError(f"Tool '{tool_name}' not found")

        config = self._configs.get(tool_name)
        if config and not config.enabled:
            raise ValueError(f"Tool '{tool_name}' is disabled")

        return await tool.ainvoke(
            input_data,
            config={"callbacks": callbacks} if callbacks else None
        )

    async def batch_invoke(
        self,
        tool_name: str,
        inputs: List[Any],
        callbacks: Optional[List] = None
    ) -> List[Any]:
        """
        批量执行 Tool

        Args:
            tool_name: Tool 名称
            inputs: 输入数据列表
            callbacks: 回调列表

        Returns:
            执行结果列表
        """
        tool = self.get_tool(tool_name)
        if not tool:
            raise ValueError(f"Tool '{tool_name}' not found")

        return await tool.abatch(
            inputs,
            config={"callbacks": callbacks} if callbacks else None
        )

    def disable_tool(self, name: str):
        """禁用 Tool"""
        if name in self._configs:
            self._configs[name].enabled = False

    def enable_tool(self, name: str):
        """启用 Tool"""
        if name in self._configs:
            self._configs[name].enabled = True

    def unregister_tool(self, name: str):
        """注销 Tool"""
        self._tools.pop(name, None)
        self._configs.pop(name, None)
        self._custom_tools.pop(name, None)
