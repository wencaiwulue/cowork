import os
import json
import re
import asyncio
import time
import traceback
from typing import List, Dict, Optional, Tuple, Any
from openai import AsyncOpenAI
from fastapi.concurrency import run_in_threadpool
from .settings import AGENTS_DIR, get_settings
from .memory import (
    get_memory_provider,
    load_memory_md,
    get_core_file,
    list_core_files_with_headers,
    maybe_compact_messages,
)
from .tools import ToolManager, register_builtin_tools
from ..models.schemas import TaskRequest

# ─── In-memory Todo store (per agent, ephemeral per server run) ───────────────
_todo_store: Dict[str, List[Dict]] = {}

TODO_SYSTEM_PROMPT = """
<todo_instructions>
When a task requires 3 or more distinct steps, use the TodoWrite pattern to track progress.
Emit a fenced JSON block at the START of your reply (before any prose):

```json
{"todos": [
  {"id": "1", "content": "Step description", "status": "pending|in_progress|completed|cancelled", "priority": "high|medium|low"}
]}
```

Lifecycle rules:
- Create all todos upfront with status=pending
- Mark the current step in_progress (only ONE at a time)
- Mark completed immediately when done
- Emit an updated todos block whenever any status changes

For trivial single-step tasks, skip todos entirely.
</todo_instructions>
"""

# ─── Fast-model selector for find_relevant_memories ──────────────────────────
# Max files to inject as relevant context (mirrors Claude Code's limit)
_MAX_RELEVANT_FILES = 5


def get_todos(agent_id: str) -> List[Dict]:
    return _todo_store.get(agent_id, [])


def set_todos(agent_id: str, todos: List[Dict]):
    _todo_store[agent_id] = todos


def _parse_todo_update(content: str, agent_id: str) -> Optional[List[Dict]]:
    """Extract ```json {"todos": [...]} ``` blocks from agent reply."""
    pattern = r"```(?:json)?\s*(\{[^`]*\"todos\"\s*:\s*\[[^\]]*\][^`]*\})\s*```"
    match = re.search(pattern, content, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(1))
        todos = data.get("todos", [])
        if isinstance(todos, list):
            set_todos(agent_id, todos)
            return todos
    except (json.JSONDecodeError, KeyError):
        pass
    return None


# ─── Tool system initialization ──────────────────────────────────────────────

# Initialize built-in tools
register_builtin_tools()

# Create global tool manager
from .tools.base import registry
tool_manager = ToolManager(registry)


def _strip_todo_blocks(content: str) -> str:
    """Remove todo JSON fences from displayed content."""
    return re.sub(
        r"```(?:json)?\s*\{[^`]*\"todos\"\s*:\s*\[[^\]]*\][^`]*\}\s*```",
        "",
        content,
        flags=re.DOTALL,
    ).strip()


# ─── Resolve LLM config (agent overrides global) ──────────────────────────────

def _resolve_llm_config(config: Dict) -> Tuple[str, str, str, str]:
    """Returns (base_url, api_key, model, fast_model)."""
    settings = get_settings()
    global_llm = settings.get("llm") or {}
    agent_llm = config.get("llm") or {}

    base_url = (agent_llm.get("base_url") or global_llm.get("base_url", "https://api.openai.com/v1")).strip().rstrip("/")
    api_key = (agent_llm.get("api_key") or global_llm.get("api_key", "")).strip()
    model = (agent_llm.get("model") or global_llm.get("model", "gpt-4o")).strip()

    # Determine default fast_model based on endpoint
    if base_url == "https://api.openai.com/v1":
        default_fast_model = "gpt-4o-mini"
    else:
        # For non-OpenAI endpoints, use the main model as fast_model
        default_fast_model = model

    fast_model = (agent_llm.get("fast_model") or global_llm.get("fast_model", default_fast_model)).strip()
    return base_url, api_key, model, fast_model


# ─── Semantic memory file selector (Claude Code: findRelevantMemories) ────────

async def find_relevant_memories(
    query: str,
    agent_id: str,
    client: AsyncOpenAI,
    fast_model: str,
) -> List[Tuple[str, str]]:
    """
    Reads headers of all core/ .md files, asks the fast LLM to pick the most
    relevant ones, then returns [(filename, content), ...] up to _MAX_RELEVANT_FILES.

    Mirrors Claude Code's selectRelevantMemories() using a cheap model call.
    """
    file_headers = list_core_files_with_headers(agent_id)
    # Always skip MEMORY.md (loaded separately) and AGENTS.md (always injected)
    candidates = [(f, h) for f, h in file_headers if f not in ("MEMORY.md", "AGENTS.md")]

    if not candidates:
        return []

    header_list = "\n".join(f"{i+1}. {fname}: {header}" for i, (fname, header) in enumerate(candidates))
    selector_prompt = (
        f"Given this user query, select up to {_MAX_RELEVANT_FILES} files from the list below "
        "that would provide the most relevant context. "
        "Respond ONLY with a JSON array of filenames, e.g. [\"SOUL.md\", \"USERS.md\"]. "
        "If none are relevant, respond with [].\n\n"
        f"Query: {query}\n\nFiles:\n{header_list}"
    )

    try:
        resp = await client.chat.completions.create(
            model=fast_model,
            messages=[{"role": "user", "content": selector_prompt}],
            max_tokens=256,
            temperature=0,
        )
        raw = (resp.choices[0].message.content or "").strip()
        # Extract JSON array
        arr_match = re.search(r"\[.*?\]", raw, re.DOTALL)
        selected_names = json.loads(arr_match.group(0)) if arr_match else []
    except Exception as e:
        print(f"WARN: find_relevant_memories selector failed: {e}")
        # Fallback: return first 2 candidate files
        selected_names = [f for f, _ in candidates[:2]]

    results = []
    for fname in selected_names:
        if not isinstance(fname, str):
            continue
        content = get_core_file(agent_id, fname)
        if content:
            results.append((fname, content))

    print(f"DEBUG: find_relevant_memories selected {[f for f,_ in results]} for query: {query[:60]}")
    return results


# ─── Layered system prompt builder (Claude Code: fetchSystemPromptParts) ──────

async def build_system_prompt(
    agent_id: str,
    config: Dict,
    query: str,
    client: AsyncOpenAI,
    fast_model: str,
    team_context: Optional[Dict] = None,
) -> str:
    """
    Build the full system prompt in Claude Code's layered order:
    1. <identity>     IDENTITY.md
    2. <soul>         SOUL.md
    3. <memory>       MEMORY.md (truncated)
    4. <relevant_ctx> Semantically selected core files
    5. <todo>         TodoWrite instructions + current todos
    6. <team>         Team context + delegation protocol
    7. <agents_md>    AGENTS.md coding conventions
    8. <user_profile> USERS.md
    """
    agent_path = os.path.join(AGENTS_DIR, agent_id)

    # Run file reads + semantic selector concurrently
    identity_task = asyncio.create_task(
        asyncio.to_thread(get_core_file, agent_id, "IDENTITY.md")
    )
    soul_task = asyncio.create_task(
        asyncio.to_thread(get_core_file, agent_id, "SOUL.md")
    )
    memory_task = asyncio.create_task(
        asyncio.to_thread(load_memory_md, agent_id)
    )
    agents_md_task = asyncio.create_task(
        asyncio.to_thread(get_core_file, agent_id, "AGENTS.md")
    )
    users_md_task = asyncio.create_task(
        asyncio.to_thread(get_core_file, agent_id, "USERS.md")
    )
    relevant_task = asyncio.create_task(
        find_relevant_memories(query, agent_id, client, fast_model)
    )

    (identity, soul, memory_md, agents_md, users_md, relevant_files) = await asyncio.gather(
        identity_task, soul_task, memory_task, agents_md_task, users_md_task, relevant_task
    )

    # Fallback identity from config
    if not identity:
        identity = (
            f"You are {config.get('name', 'an AI agent')}, "
            f"specialized in {config.get('description', 'general tasks')}."
        )

    parts: List[str] = []

    # Layer 1: Identity
    parts.append(f"<identity>\n{identity}\n</identity>")

    # Layer 2: Soul/personality
    if soul:
        parts.append(f"<soul>\n{soul}\n</soul>")

    # Layer 3: Long-term memory (always-loaded, truncated)
    if memory_md:
        parts.append(f"<memory>\n{memory_md}\n</memory>")

    # Layer 4: Semantically relevant context files
    if relevant_files:
        ctx_parts = []
        for fname, content in relevant_files:
            ctx_parts.append(f"<file name=\"{fname}\">\n{content}\n</file>")
        parts.append(f"<relevant_context>\n{''.join(ctx_parts)}\n</relevant_context>")

    # Layer 5: TodoWrite instructions + current state
    parts.append(TODO_SYSTEM_PROMPT)
    current_todos = get_todos(agent_id)
    if current_todos:
        parts.append(
            f"<current_todos>\n{json.dumps(current_todos, indent=2)}\n</current_todos>"
        )

    # Layer 6: Team context + delegation
    if team_context:
        team_name = team_context.get("team_name", "Unknown")
        members = team_context.get("members", [])
        member_list = "\n".join(
            f"- **{m['name']}** (Role: {'TL' if m.get('is_tl') else 'MEMBER'}) "
            f"Skills: {', '.join(m.get('skills', []))}"
            for m in members
        )
        parts.append(
            f"<team>\n### TEAM: {team_name}\n{member_list}\n\n"
            "Protocol: Use `[DELEGATE: @Name] task` to assign work.\n</team>"
        )

    # Layer 7: Coding conventions / AGENTS.md
    if agents_md:
        parts.append(f"<agents_md>\n{agents_md}\n</agents_md>")

    # Layer 8: User profile
    if users_md:
        parts.append(f"<user_profile>\n{users_md}\n</user_profile>")

    return "\n\n".join(parts)


# ─── Legacy prompt loader (kept for /prompt endpoint) ────────────────────────

def parse_markdown(content: str) -> Dict[str, str]:
    sections: Dict[str, str] = {}
    lines = content.split("\n")
    current_header = "General"
    current_content: List[str] = []
    for line in lines:
        m = re.match(r"^#+\s+(.+)$", line)
        if m:
            if current_content:
                sections[current_header] = "\n".join(current_content).strip()
            current_header = m.group(1)
            current_content = []
        else:
            current_content.append(line)
    if current_content:
        sections[current_header] = "\n".join(current_content).strip()
    return sections


async def get_agent_prompt(agent_id: str) -> Dict:
    agent_path = os.path.join(AGENTS_DIR, agent_id)
    prompt_parts: List[str] = []
    core_dir = os.path.join(agent_path, "core")
    if os.path.exists(core_dir):
        for filename in sorted(os.listdir(core_dir)):
            if filename.endswith(".md"):
                with open(os.path.join(core_dir, filename), "r") as f:
                    sections = parse_markdown(f.read())
                    for header, text in sections.items():
                        prompt_parts.append(f"## {header}\n{text}")
    return {"prompt": "\n\n".join(prompt_parts)}


# ─── Core task logic ──────────────────────────────────────────────────────────

async def run_agent_task_logic(
    agent_id: str,
    request: TaskRequest,
) -> Tuple[AsyncOpenAI, str, List[Dict], Any, Dict]:
    """
    Prepares and returns (client, model, messages, mem, llm_cfg).
    Builds layered system prompt, compacts context if needed.
    """
    agent_path = os.path.join(AGENTS_DIR, agent_id)
    with open(os.path.join(agent_path, "config.json"), "r") as f:
        config = json.load(f)

    base_url, api_key, model, fast_model = _resolve_llm_config(config)
    llm_cfg = {"base_url": base_url, "api_key": api_key, "model": model, "fast_model": fast_model}

    if not api_key:
        print("CRITICAL: API Key is missing! Check settings.")

    client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    # Build layered system prompt (concurrent I/O + semantic selector)
    system_prompt = await build_system_prompt(
        agent_id=agent_id,
        config=config,
        query=request.message or "",
        client=client,
        fast_model=fast_model,
        team_context=request.team_context,
    )

    # Episodic memory search (concurrent with system prompt build above,
    # but we append results after the prompt is ready)
    mem = get_memory_provider(agent_id)
    try:
        relevant = await run_in_threadpool(mem.search, request.message, agent_id)
        if relevant:
            mem_text = "\n".join(f"- {m['text']}" for m in relevant)
            system_prompt += f"\n\n<episodic_memories>\n{mem_text}\n</episodic_memories>"
    except Exception as mem_err:
        print(f"WARN: Episodic memory search failed: {mem_err}")

    messages: List[Dict] = [{"role": "system", "content": system_prompt}]
    if request.history:
        messages.extend(request.history)
    messages.append({"role": "user", "content": request.message})

    # Context compaction at 75% limit
    messages = await maybe_compact_messages(messages, model, client, fast_model)

    print(f"DEBUG: run_agent_task_logic — agent={agent_id}, model={model}, msgs={len(messages)}, prompt_len={len(system_prompt)}")
    return client, model, messages, mem, llm_cfg


async def run_agent_task(agent_id: str, request: TaskRequest) -> Dict:
    """Synchronous (non-streaming) task execution. Used by orchestrator."""
    client, model, messages, mem, llm_cfg = await run_agent_task_logic(agent_id, request)

    try:
        # Load agent config to get tool list
        agent_path = os.path.join(AGENTS_DIR, agent_id)
        with open(os.path.join(agent_path, "config.json"), "r") as f:
            config = json.load(f)

        agent_tools = config.get("tools", [])

        # Get tool schemas for available tools
        tools_schemas = tool_manager.get_available_tools(agent_tools)

        # Check if API supports tool calls (OpenAI-compatible)
        base_url = llm_cfg.get("base_url", "")
        supports_tools = base_url == "https://api.openai.com/v1"  # Only standard OpenAI supports tools for now

        # Tool execution loop
        max_iterations = 10  # Prevent infinite loops
        final_content = ""
        tool_executions = []  # Initialize empty list

        for iteration in range(max_iterations):
            # Prepare API call parameters
            api_params = {
                "model": model,
                "messages": messages,
            }

            # Add tools if available and API supports them
            if tools_schemas and supports_tools:
                api_params["tools"] = tools_schemas
                api_params["tool_choice"] = "auto"

            # Call LLM
            resp = await client.chat.completions.create(**api_params)

            # Check for tool calls
            tool_calls = resp.choices[0].message.tool_calls if resp.choices[0].message.tool_calls else []

            if tool_calls:
                # Add assistant message with tool calls
                messages.append({
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "id": call.id,
                            "type": call.type,
                            "function": {
                                "name": call.function.name,
                                "arguments": call.function.arguments,
                            }
                        }
                        for call in tool_calls
                    ],
                })

                # Execute each tool call
                # tool_executions already initialized, append to it
                for call in tool_calls:
                    try:
                        # Normalize tool name
                        normalized_tool_name = tool_manager.normalize_tool_name(call.function.name)
                        if not normalized_tool_name:
                            raise ValueError(f"Tool '{call.function.name}' not found")

                        # Parse arguments
                        args = json.loads(call.function.arguments)

                        # Execute tool with detailed information
                        result = await tool_manager.execute_tool(
                            normalized_tool_name,
                            args
                        )

                        # Add tool result to messages
                        messages.append({
                            "role": "tool",
                            "tool_call_id": call.id,
                            "content": json.dumps(result),
                        })

                        # Record tool execution
                        tool_executions.append({
                            "type": "success",
                            "tool_name": normalized_tool_name,
                            "call_id": call.id,
                            "timestamp": time.time(),
                            "result": result,
                            "arguments": args,
                        })

                    except Exception as e:
                        print(f"WARN: Tool execution failed: {e}")
                        error_result = {
                            "success": False,
                            "error": str(e),
                            "tool": call.function.name if hasattr(call, 'function') else "unknown",
                        }
                        messages.append({
                            "role": "tool",
                            "tool_call_id": call.id,
                            "content": json.dumps(error_result),
                        })

                        # Record tool execution error
                        tool_executions.append({
                            "type": "error",
                            "tool_name": call.function.name if hasattr(call, 'function') else "unknown",
                            "call_id": call.id,
                            "timestamp": time.time(),
                            "error": str(e),
                            "arguments": json.loads(call.function.arguments) if hasattr(call, 'function') else {},
                        })

                # Continue loop to get next LLM response
                continue

            # No tool calls - final response
            final_content = resp.choices[0].message.content or ""
            break

        if not final_content and iteration == max_iterations - 1:
            final_content = "Tool call loop reached maximum iterations"

        # Parse and strip todo blocks
        _parse_todo_update(final_content, agent_id)

        # Add tool execution summary to final content if there were tool calls
        if tool_executions:
            tool_summary_lines = ["\n\n### Tool Execution Summary"]
            for i, exec_info in enumerate(tool_executions, 1):
                if exec_info.get("type") == "success":
                    tool_summary_lines.append(f"\n**Tool {i}: {exec_info.get('tool_name', 'Unknown')}**")
                    tool_summary_lines.append(f"- Status: ✅ Success")
                    tool_summary_lines.append(f"- Arguments: {json.dumps(exec_info.get('arguments', {}), indent=2)}")
                    result = exec_info.get('result', {})
                    if isinstance(result, dict):
                        # Format dict result
                        if 'stdout' in result and result['stdout']:
                            tool_summary_lines.append(f"- Output: {result.get('stdout', '')}")
                        elif 'success' in result:
                            tool_summary_lines.append(f"- Result: {result.get('success', '')}")
                        else:
                            tool_summary_lines.append(f"- Result: {json.dumps(result, indent=2)}")
                    else:
                        tool_summary_lines.append(f"- Result: {result}")
                    tool_summary_lines.append(f"- Execution Time: {exec_info.get('execution_time', 0):.2f}s")
                else:
                    tool_summary_lines.append(f"\n**Tool {i}: {exec_info.get('tool_name', 'Unknown')}**")
                    tool_summary_lines.append(f"- Status: ❌ Error")
                    tool_summary_lines.append(f"- Error: {exec_info.get('error', 'Unknown error')}")
                    tool_summary_lines.append(f"- Arguments: {json.dumps(exec_info.get('arguments', {}), indent=2)}")

            tool_summary = "\n".join(tool_summary_lines)
            final_content = tool_summary + "\n\n" + final_content

        # Store in episodic memory
        try:
            if final_content.strip():
                await run_in_threadpool(
                    mem.add,
                    f"User: {request.message}\nAssistant: {final_content}",
                    agent_id,
                )
        except Exception as mem_err:
            print(f"WARN: Memory add failed: {mem_err}")

        return {"content": final_content, "tool_executions": tool_executions}

    except Exception as e:
        print(f"ERROR in run_agent_task for {agent_id}: {e}\n{traceback.format_exc()}")
        raise
    finally:
        await client.close()


# ─── Streaming task with SSE todo events ──────────────────────────────────────

async def stream_agent_task(agent_id: str, request: TaskRequest):
    """
    AsyncGenerator yielding SSE data lines.
    Parses TodoWrite blocks on the fly and emits {"todos": [...]} SSE events.
    Supports tool calls with iterative execution.
    """
    client = None
    try:
        client, model, messages, mem, llm_cfg = await run_agent_task_logic(agent_id, request)
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
        return

    try:
        # Load agent config to get tool list
        agent_path = os.path.join(AGENTS_DIR, agent_id)
        with open(os.path.join(agent_path, "config.json"), "r") as f:
            config = json.load(f)

        agent_tools = config.get("tools", [])
        tools_schemas = tool_manager.get_available_tools(agent_tools)

        # Tool execution loop
        max_iterations = 10
        iteration = 0
        final_content = ""
        tool_executions = []  # Track tool executions for summary

        while iteration < max_iterations:
            iteration += 1

            # Prepare API call parameters
            api_params = {
                "model": model,
                "messages": messages,
                "stream": True,
            }

            # Add tools if available
            if tools_schemas:
                api_params["tools"] = tools_schemas
                api_params["tool_choice"] = "auto"

            full_content = ""
            todo_buffer = ""
            tool_calls_accumulated = []

            try:
                stream = await client.chat.completions.create(**api_params)

                async for chunk in stream:
                    if not chunk.choices:
                        continue

                    delta = chunk.choices[0].delta
                    content_piece = getattr(delta, "content", None) or ""
                    reasoning_piece = getattr(delta, "reasoning_content", None) or ""

                    # Check for tool calls in the delta
                    if hasattr(delta, 'tool_calls') and delta.tool_calls:
                        for tool_call in delta.tool_calls:
                            if tool_call.index >= len(tool_calls_accumulated):
                                # New tool call
                                tool_calls_accumulated.append({
                                    "id": tool_call.id,
                                    "type": tool_call.type,
                                    "function": {
                                        "name": tool_call.function.name if tool_call.function else "",
                                        "arguments": tool_call.function.arguments if tool_call.function else "",
                                    }
                                })
                            else:
                                # Append to existing tool call arguments
                                if tool_call.function and tool_call.function.arguments:
                                    existing = tool_calls_accumulated[tool_call.index]
                                    existing["function"]["arguments"] += tool_call.function.arguments

                    if content_piece or reasoning_piece:
                        full_content += content_piece
                        todo_buffer += content_piece

                        # Check if we just completed a todo block
                        if "```" in todo_buffer:
                            todos = _parse_todo_update(todo_buffer, agent_id)
                            if todos is not None:
                                yield f"data: {json.dumps({'todos': todos})}\n\n"
                                # Reset buffer after successful parse
                                todo_buffer = ""

                        yield f"data: {json.dumps({'content': content_piece, 'reasoning': reasoning_piece})}\n\n"

                # After stream completes, check for tool calls
                if tool_calls_accumulated:
                    # Add assistant message with tool calls
                    messages.append({
                        "role": "assistant",
                        "content": full_content,
                        "tool_calls": tool_calls_accumulated,
                    })

                    # Execute each tool call
                    for tool_call in tool_calls_accumulated:
                        try:
                            # Normalize tool name
                            tool_name = tool_call["function"]["name"]
                            normalized_tool_name = tool_manager.normalize_tool_name(tool_name)
                            if not normalized_tool_name:
                                raise ValueError(f"Tool '{tool_name}' not found")

                            # Parse arguments
                            args = json.loads(tool_call["function"]["arguments"])

                            # Send tool execution start event with arguments
                            yield f"data: {json.dumps({'tool_start': {
                                'tool_name': normalized_tool_name,
                                'call_id': tool_call['id'],
                                'timestamp': time.time(),
                                'arguments': args
                            }})}\n\n"

                            # Execute tool with normalized name
                            result = await tool_manager.execute_tool(
                                normalized_tool_name,
                                args
                            )

                            # Add tool result to messages
                            messages.append({
                                "role": "tool",
                                "tool_call_id": tool_call["id"],
                                "content": json.dumps(result),
                            })

                            # Send tool result as SSE event
                            yield f"data: {json.dumps({'tool_result': {
                                'call_id': tool_call['id'],
                                'result': result,
                                'timestamp': time.time()
                            }})}\n\n"

                            # Record tool execution for summary
                            tool_executions.append({
                                "type": "success",
                                "tool_name": normalized_tool_name,
                                "call_id": tool_call["id"],
                                "timestamp": time.time(),
                                "result": result,
                                "arguments": args,
                            })

                        except Exception as e:
                            print(f"WARN: Tool execution failed: {e}")
                            error_result = {
                                "success": False,
                                "error": str(e),
                                "tool": tool_call["function"]["name"] if "function" in tool_call else "unknown",
                            }
                            messages.append({
                                "role": "tool",
                                "tool_call_id": tool_call["id"],
                                "content": json.dumps(error_result),
                            })
                            yield f"data: {json.dumps({'tool_error': {
                                'call_id': tool_call['id'],
                                'error': str(e),
                                'timestamp': time.time()
                            }})}\n\n"

                            # Record tool execution error for summary
                            tool_executions.append({
                                "type": "error",
                                "tool_name": tool_call["function"]["name"] if "function" in tool_call else "unknown",
                                "call_id": tool_call["id"],
                                "timestamp": time.time(),
                                "error": str(e),
                                "arguments": json.loads(tool_call["function"]["arguments"]) if "function" in tool_call and tool_call["function"]["arguments"] else {},
                            })

                    # Continue loop to get next LLM response
                    continue

                # No tool calls - final response
                final_content = full_content
                break

            except Exception as e:
                print(f"ERROR in stream_agent_task iteration {iteration}: {e}\n{traceback.format_exc()}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
                break

        if iteration == max_iterations and not final_content:
            final_content = "Tool call loop reached maximum iterations"

        # Add tool execution summary to final content if there were tool calls
        if tool_executions:
            tool_summary_lines = ["\n\n### Tool Execution Summary"]
            for i, exec_info in enumerate(tool_executions, 1):
                if exec_info.get("type") == "success":
                    tool_summary_lines.append(f"\n**Tool {i}: {exec_info.get('tool_name', 'Unknown')}**")
                    tool_summary_lines.append(f"- Status: ✅ Success")
                    tool_summary_lines.append(f"- Arguments: {json.dumps(exec_info.get('arguments', {}), indent=2)}")
                    result = exec_info.get('result', {})
                    if isinstance(result, dict):
                        # Format dict result
                        if 'stdout' in result and result['stdout']:
                            tool_summary_lines.append(f"- Output: {result.get('stdout', '')}")
                        elif 'success' in result:
                            tool_summary_lines.append(f"- Result: {result.get('success', '')}")
                        else:
                            tool_summary_lines.append(f"- Result: {json.dumps(result, indent=2)}")
                    else:
                        tool_summary_lines.append(f"- Result: {result}")
                    tool_summary_lines.append(f"- Execution Time: {exec_info.get('execution_time', 0):.2f}s")
                else:
                    tool_summary_lines.append(f"\n**Tool {i}: {exec_info.get('tool_name', 'Unknown')}**")
                    tool_summary_lines.append(f"- Status: ❌ Error")
                    tool_summary_lines.append(f"- Error: {exec_info.get('error', 'Unknown error')}")
                    tool_summary_lines.append(f"- Arguments: {json.dumps(exec_info.get('arguments', {}), indent=2)}")

            tool_summary = "\n".join(tool_summary_lines)
            final_content = tool_summary + "\n\n" + final_content

        # Store completed response in episodic memory
        if final_content.strip():
            try:
                await run_in_threadpool(
                    mem.add,
                    f"User: {request.message}\nAssistant: {final_content}",
                    agent_id,
                )
            except Exception as mem_err:
                print(f"WARN: Memory add failed: {mem_err}")

        yield "data: [DONE]\n\n"

    finally:
        if client:
            await client.close()
