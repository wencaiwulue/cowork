"""
Base tool interface and registry.
"""
import json
import inspect
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional, Callable, Type, Union
from enum import Enum


class ToolParameterType(str, Enum):
    """JSON Schema parameter types."""
    STRING = "string"
    NUMBER = "number"
    INTEGER = "integer"
    BOOLEAN = "boolean"
    ARRAY = "array"
    OBJECT = "object"


class ToolParameter:
    """Parameter definition for a tool."""

    def __init__(
        self,
        name: str,
        description: str,
        type: ToolParameterType,
        required: bool = True,
        enum: Optional[List[Any]] = None,
        **extra: Any,
    ):
        self.name = name
        self.description = description
        self.type = type
        self.required = required
        self.enum = enum
        self.extra = extra

    def to_schema(self) -> Dict[str, Any]:
        """Convert to JSON Schema."""
        schema = {
            "type": self.type.value,
            "description": self.description,
        }
        if self.enum:
            schema["enum"] = self.enum
        if self.extra:
            schema.update(self.extra)
        return schema


class BaseTool(ABC):
    """Base class for all tools."""

    name: str
    description: str
    parameters: List[ToolParameter]

    def __init__(self):
        if not hasattr(self, 'name'):
            raise ValueError(f"Tool class {self.__class__.__name__} must define 'name'")
        if not hasattr(self, 'description'):
            raise ValueError(f"Tool class {self.__class__.__name__} must define 'description'")
        if not hasattr(self, 'parameters'):
            self.parameters = []

    @abstractmethod
    async def execute(self, **kwargs) -> Any:
        """Execute the tool with given arguments."""
        pass

    def get_schema(self) -> Dict[str, Any]:
        """Get OpenAI-compatible function schema."""
        properties = {}
        required = []

        for param in self.parameters:
            properties[param.name] = param.to_schema()
            if param.required:
                required.append(param.name)

        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
            }
        }

    def __call__(self, **kwargs) -> Any:
        """Allow tool to be called directly."""
        return self.execute(**kwargs)


class ToolRegistry:
    """Registry for managing tools."""

    def __init__(self):
        self._tools: Dict[str, BaseTool] = {}

    def register(self, tool: Union[BaseTool, Type[BaseTool]]) -> None:
        """Register a tool instance or class."""
        if inspect.isclass(tool):
            tool = tool()
        self._tools[tool.name] = tool

    def get(self, name: str) -> Optional[BaseTool]:
        """Get a tool by name."""
        return self._tools.get(name)

    def list(self) -> List[str]:
        """List all registered tool names."""
        return list(self._tools.keys())

    def get_all(self) -> Dict[str, BaseTool]:
        """Get all registered tools."""
        return self._tools.copy()

    def get_schemas(self, tool_names: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """Get schemas for specified tools (or all if None)."""
        if tool_names is None:
            tools = self._tools.values()
        else:
            tools = [self._tools[name] for name in tool_names if name in self._tools]

        return [tool.get_schema() for tool in tools]


# Global registry instance
registry = ToolRegistry()