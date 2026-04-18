"""
Tool manager for executing tools and handling results.
"""
import json
import traceback
from typing import Dict, Any, List, Optional, Tuple
from .base import ToolRegistry, BaseTool


class ToolManager:
    """Manages tool execution for agents."""

    def __init__(self, registry: ToolRegistry):
        self.registry = registry
        # Tool name mapping: user-friendly names to actual tool names
        self.tool_name_map = {
            # Built-in tools mappings
            "bash": "bash",
            "Bash Shell": "bash",
            "file_editor": "file_editor",
            "File Editor": "file_editor",
            "python": "python",
            "Python Interpreter": "python",
            "web_search": "web_search",
            "Web Search": "web_search",
            "gmail": "gmail",
            "Gmail API": "gmail",
        }

    def normalize_tool_name(self, tool_name: str) -> Optional[str]:
        """Convert user-friendly tool name to actual tool name."""
        # Try direct lookup
        if tool_name in self.tool_name_map:
            return self.tool_name_map[tool_name]

        # Try case-insensitive lookup
        for key, value in self.tool_name_map.items():
            if key.lower() == tool_name.lower():
                return value

        return None

    def get_available_tools(self, agent_tools: List[str]) -> List[Dict[str, Any]]:
        """Get schemas for tools available to an agent in OpenAI format."""
        available = []
        for tool_name in agent_tools:
            normalized = self.normalize_tool_name(tool_name)
            if normalized:
                tool = self.registry.get(normalized)
                if tool:
                    # Wrap in OpenAI tool format
                    available.append({
                        "type": "function",
                        "function": tool.get_schema()
                    })
        return available

    async def execute_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a tool and return detailed execution information."""
        import time
        start_time = time.time()

        # Normalize tool name
        normalized = self.normalize_tool_name(tool_name)
        if not normalized:
            return {
                "success": False,
                "error": f"Tool '{tool_name}' not found",
                "tool": tool_name,
                "execution_time": time.time() - start_time,
                "timestamp": start_time,
            }

        tool = self.registry.get(normalized)
        if not tool:
            return {
                "success": False,
                "error": f"Tool '{normalized}' not found in registry",
                "tool": tool_name,
                "normalized_name": normalized,
                "execution_time": time.time() - start_time,
                "timestamp": start_time,
            }

        try:
            # Validate arguments
            validated_args = self._validate_arguments(tool, arguments)

            # Execute tool
            result = await tool.execute(**validated_args)

            execution_time = time.time() - start_time

            return {
                "success": True,
                "result": result,
                "tool": tool_name,
                "normalized_name": normalized,
                "arguments": arguments,
                "validated_arguments": validated_args,
                "execution_time": execution_time,
                "start_time": start_time,
                "end_time": start_time + execution_time,
                "timestamp": start_time,
                "status": "completed",
                "tool_description": tool.description,
            }
        except Exception as e:
            execution_time = time.time() - start_time
            return {
                "success": False,
                "error": str(e),
                "tool": tool_name,
                "normalized_name": normalized,
                "arguments": arguments,
                "execution_time": execution_time,
                "start_time": start_time,
                "end_time": start_time + execution_time,
                "timestamp": start_time,
                "status": "failed",
                "tool_description": tool.description,
                "traceback": traceback.format_exc(),
            }

    def _validate_arguments(self, tool: BaseTool, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Validate arguments against tool parameters."""
        validated = {}

        for param in tool.parameters:
            param_name = param.name

            if param_name in arguments:
                # Type checking would go here
                validated[param_name] = arguments[param_name]
            elif param.required:
                raise ValueError(f"Missing required parameter: {param_name}")

        return validated

    def parse_tool_calls(self, llm_response: str) -> List[Dict[str, Any]]:
        """
        Parse tool calls from LLM response.
        Supports both OpenAI function calling format and custom format.
        """
        # Try to parse as JSON first (OpenAI format)
        try:
            data = json.loads(llm_response)

            # Check if it's an OpenAI tool_calls format
            if isinstance(data, dict) and "choices" in data:
                # Extract from OpenAI response format
                return self._parse_openai_tool_calls(data)
            elif isinstance(data, dict) and "tool_calls" in data:
                # Direct tool_calls format
                return data.get("tool_calls", [])

        except json.JSONDecodeError:
            pass

        # Try to extract tool calls from text
        tool_calls = self._extract_tool_calls_from_text(llm_response)
        if tool_calls:
            return tool_calls

        return []

    def _parse_openai_tool_calls(self, openai_response: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Parse tool calls from OpenAI response format."""
        tool_calls = []

        for choice in openai_response.get("choices", []):
            message = choice.get("message", {})
            for call in message.get("tool_calls", []):
                tool_calls.append({
                    "id": call.get("id"),
                    "type": "function",
                    "function": {
                        "name": call.get("function", {}).get("name"),
                        "arguments": call.get("function", {}).get("arguments"),
                    }
                })

        return tool_calls

    def _extract_tool_calls_from_text(self, text: str) -> List[Dict[str, Any]]:
        """
        Extract tool calls from text using pattern matching.
        Example: ```tool
        {"name": "bash", "arguments": {"command": "ls -la"}}
        ```
        """
        tool_calls = []

        # Look for tool call blocks
        lines = text.split('\n')
        in_tool_block = False
        tool_content = []

        for line in lines:
            if line.strip().startswith('```tool'):
                in_tool_block = True
                tool_content = []
            elif in_tool_block and line.strip().startswith('```'):
                in_tool_block = False
                # Try to parse tool content
                try:
                    tool_data = json.loads('\n'.join(tool_content))
                    if isinstance(tool_data, dict):
                        tool_calls.append({
                            "type": "function",
                            "function": {
                                "name": tool_data.get("name"),
                                "arguments": tool_data.get("arguments", {}),
                            }
                        })
                except json.JSONDecodeError:
                    pass
            elif in_tool_block:
                tool_content.append(line)

        return tool_calls