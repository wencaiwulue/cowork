import os
import json
import re
import traceback
from openai import AsyncOpenAI
from fastapi.concurrency import run_in_threadpool
from .settings import AGENTS_DIR, get_settings
from .memory import get_memory_provider
from ..models.schemas import TaskRequest

def parse_markdown(content: str):
    sections = {}
    lines = content.split('\n')
    current_header = 'General'
    current_content = []
    for line in lines:
        match = re.match(r'^#+\s+(.+)$', line)
        if match:
            if current_content:
                sections[current_header] = '\n'.join(current_content).strip()
            current_header = match.group(1)
            current_content = []
        else:
            current_content.append(line)
    if current_content:
        sections[current_header] = '\n'.join(current_content).strip()
    return sections

async def get_agent_prompt(agent_id: str):
    agent_path = os.path.join(AGENTS_DIR, agent_id)
    prompt_parts = []
    core_dir = os.path.join(agent_path, "core")
    if os.path.exists(core_dir):
        for filename in sorted(os.listdir(core_dir)):
            if filename.endswith(".md"):
                with open(os.path.join(core_dir, filename), "r") as f:
                    sections = parse_markdown(f.read())
                    for header, text in sections.items():
                        prompt_parts.append(f"## {header}\n{text}")
    return {"prompt": "\n\n".join(prompt_parts)}

async def run_agent_task_logic(agent_id: str, request: TaskRequest):
    print(f"DEBUG: run_agent_task_logic called for agent {agent_id}")
    agent_path = os.path.join(AGENTS_DIR, agent_id)
    print(f"DEBUG: Agent path: {agent_path}")
    with open(os.path.join(agent_path, "config.json"), "r") as f:
        config = json.load(f)
    print(f"DEBUG: Loaded agent config, keys: {list(config.keys())}")
    
    prompt_res = await get_agent_prompt(agent_id)
    system_prompt = prompt_res["prompt"]
    
    # Team Context
    if request.team_context:
        team_name = request.team_context.get("team_name", "Unknown")
        members = request.team_context.get("members", [])
        member_list = "\n".join([f"- **{m['name']}** (Role: {'TL' if m.get('is_tl') else 'MEMBER'}) Skills: {', '.join(m.get('skills', []))}" for m in members])
        system_prompt += f"\n\n### TEAM: {team_name}\n{member_list}\n\nProtocol: Use `[DELEGATE: @Name] task` to assign work."

    # LLM Settings: Agent config takes precedence, then global settings
    settings = get_settings()
    global_llm = settings.get("llm") or {}
    agent_llm = config.get("llm") or {}
    
    base_url = (agent_llm.get("base_url") or global_llm.get("base_url", "https://api.openai.com/v1")).strip().rstrip('/')
    api_key = (agent_llm.get("api_key") or global_llm.get("api_key", "")).strip()
    model = (agent_llm.get("model") or global_llm.get("model", "gpt-4o")).strip()

    print(f"DEBUG: Initializing LLM client for agent {agent_id}")
    print(f"DEBUG: Base URL: {base_url}")
    print(f"DEBUG: Model: {model}")
    print(f"DEBUG: API Key length: {len(api_key)}")
    
    if not api_key:
        print("CRITICAL: API Key is missing! Check settings.")

    # Memory
    print(f"DEBUG: Getting memory provider for agent {agent_id}")
    mem = get_memory_provider(agent_id)
    try:
        print(f"DEBUG: Searching memory for query: {request.message[:50] if request.message else 'None'}")
        relevant = await run_in_threadpool(mem.search, request.message, user_id=agent_id)
        print(f"DEBUG: Memory search returned {len(relevant) if relevant else 0} relevant items")
        if relevant:
            mem_text = "\n".join([f"- {m['text']}" for m in relevant])
            system_prompt += f"\n\n### RELEVANT MEMORIES\n{mem_text}"
            print(f"DEBUG: Added {len(relevant)} memory items to system prompt")
    except Exception as mem_err:
        print(f"WARN: Memory search failed: {mem_err}")

    client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    print(f"DEBUG: Created AsyncOpenAI client with base_url: {base_url}")
    messages = [{"role": "system", "content": system_prompt}]
    if request.history: messages.extend(request.history)
    messages.append({"role": "user", "content": request.message})
    print(f"DEBUG: Final message count: {len(messages)}")
    print(f"DEBUG: System prompt length: {len(system_prompt)} characters")

    # Return required components for the route to handle streaming or sync
    print(f"DEBUG: run_agent_task_logic completed successfully for agent {agent_id}")
    return client, model, messages, mem

async def run_agent_task(agent_id: str, request: TaskRequest):
    """Executes a task synchronously (returns full content)"""
    print(f"DEBUG: run_agent_task called for agent {agent_id}")
    client, model, messages, mem = await run_agent_task_logic(agent_id, request)
    try:
        print(f"DEBUG: Making LLM API call with model {model}, {len(messages)} messages")
        resp = await client.chat.completions.create(model=model, messages=messages)
        content = resp.choices[0].message.content
        print(f"DEBUG: LLM response received, content length: {len(content) if content else 0}")

        # Store in memory
        try:
            if content.strip():
                print(f"DEBUG: Storing response in memory for agent {agent_id}")
                await run_in_threadpool(mem.add, f"User: {request.message}\nAssistant: {content}", user_id=agent_id)
        except Exception as mem_err:
            print(f"DEBUG: Memory add error: {mem_err}")

        print(f"DEBUG: run_agent_task completed successfully for agent {agent_id}")
        return {"content": content}
    except Exception as e:
        print(f"ERROR in run_agent_task for agent {agent_id}: {str(e)}")
        print(f"DEBUG: Full traceback:\n{traceback.format_exc()}")
        raise e
    finally:
        print(f"DEBUG: Closing LLM client for agent {agent_id}")
        await client.close()
