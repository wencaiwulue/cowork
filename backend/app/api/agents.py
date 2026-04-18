import os
import json
import uuid
from typing import List, Dict
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

from ..models.schemas import AgentConfig, TaskRequest
from ..services.settings import AGENTS_DIR
from ..services.agent_runner import (
    get_agent_prompt, stream_agent_task,
    get_todos, set_todos
)
from ..services.memory import get_memory_provider, load_memory_md, get_agent_memory_by_scope

router = APIRouter()

AGENTS_MD_CONTENT = """<project_context_discovery>
Before starting any task, automatically discover and understand the project context:

1. **Read Project Documentation**: Look for and read these files in order of priority:
   - `README.md` - Project overview, setup instructions, and high-level architecture
   - `AGENTS.md` (this file) - Agent-specific instructions and conventions
   - `CONTRIBUTING.md` - Contribution guidelines and development practices
   - `docs/` directory - Additional project documentation

2. **Understand Project Structure**:
   - Identify the project type (web app, library, CLI tool, etc.)
   - Locate configuration files (package.json, Cargo.toml, pyproject.toml, etc.)
   - Understand the directory structure and module organization
   - Identify entry points and main components

3. **Analyze Code Conventions**:
   - Check linting/formatting configs (.eslintrc, .prettierrc, rustfmt.toml, etc.)
   - Review existing code to understand naming conventions and patterns
   - Identify testing frameworks and conventions
</project_context_discovery>

<following_conventions>
When making changes to files, first understand the file's code conventions. Mimic code style, use existing libraries and utilities, and follow existing patterns.

- NEVER assume that a given library is available, even if it is well known. Whenever you write code that uses a library or framework, first check that the codebase already uses the given library. For example, look at neighbouring files, or check package.json / requirements.txt / Cargo.toml / go.mod, etc.
- When you create a new component, first look at existing components to see how they're written; consider framework choice, naming conventions, typing, and other conventions.
- When you edit a piece of code, first look at the code's surrounding context (especially its imports) to understand the code's choice of frameworks and libraries. Make the change in a way that is most idiomatic.
- Always follow security best practices. Never introduce code that exposes or logs secrets and keys. Never commit secrets or keys to the repository.
</following_conventions>

<code_style>
- Add code comments sparingly. Focus on *why* something is done, especially for complex logic, rather than *what* is done. Only add high-value comments if necessary for clarity or if requested by the user.
- Do not edit comments that are separate from the code you are changing.
- NEVER talk to the user or describe your changes through comments.
</code_style>

<editing_constraints>
- Default to ASCII when editing or creating files. Only introduce non-ASCII or other Unicode characters when there is a clear justification and the file already uses them.
- Only add comments if they are necessary to make a non-obvious block easier to understand.
- Do NOT revert changes to the codebase unless asked to do so by the user. Only revert changes made by you if they have resulted in an error or if the user has explicitly asked you to revert.
</editing_constraints>

<doing_tasks>
## Software engineering tasks

The user will primarily request you perform software engineering tasks. This includes solving bugs, adding new functionality, refactoring code, explaining code, and more. For these tasks the following steps are recommended:

1. **Discover:** Read relevant documentation (README, AGENTS.md, CONTRIBUTING.md, docs/) to understand project context.
2. **Understand:** Use search tools extensively (in parallel if independent) to understand file structures, existing code patterns, and conventions. Use read to understand context and validate assumptions.
3. **Plan:** Build a coherent plan grounded in your understanding. Share a concise yet clear plan with the user if it would help. Consider writing unit tests as part of the plan for self-verification.
4. **Implement:** Use the appropriate tools (edit, write, exec, etc.) to act on the plan, strictly adhering to the project's established conventions.
5. **Verify (Tests):** If applicable and feasible, verify the changes using the project's testing procedures. Identify the correct test commands by examining README files, build/package configuration (e.g. package.json), or existing test execution patterns. NEVER assume standard test commands.
6. **Verify (Standards):** After making code changes, execute the project-specific build, linting, and type-checking commands (e.g. tsc, npm run lint, ruff check .) if available. This ensures code quality and adherence to standards.

## New applications

When building a new application:
1. **Discover:** Read any existing project documentation to understand context.
2. **Understand Requirements:** Analyse the request to identify core features, desired UX, visual aesthetic, application type, and explicit constraints. Ask concise clarification questions if critical info is missing.
3. **Propose Plan:** Formulate and present a high-level development plan covering: application type and purpose, key technologies, main features and interactions, and visual design approach.
4. **User Approval:** Obtain user approval for the proposed plan.
5. **Implementation:** Autonomously implement each feature per the approved plan. Scaffold using appropriate CLI tools (npm init, create-react-app, etc.). Proactively create placeholder assets to ensure the application is visually coherent and functional.
6. **Verify:** Review work against the original request. Fix bugs and deviations. Ensure styling and interactions produce a high-quality, functional prototype. Build the application and ensure there are no compile errors.
7. **Solicit Feedback:** Provide instructions on how to start the application and request user feedback.
</doing_tasks>

<git_hygiene>
- You may be in a dirty git worktree.
  * NEVER revert existing changes you did not make unless explicitly requested, since these changes were made by the user.
  * If asked to make a commit or code edits and there are unrelated changes, don't revert those changes.
  * If the changes are in files you've touched recently, read carefully and understand how you can work with the changes rather than reverting them.
  * If the changes are in unrelated files, just ignore them and don't revert them.
- Do not amend commits unless explicitly requested.
- NEVER use destructive commands like `git reset --hard` or `git checkout --` unless specifically requested or approved by the user.
</git_hygiene>

<git_commit>
Only create commits when requested by the user. If unclear, ask first. When creating a git commit:

Git Safety Protocol:
- NEVER update the git config
- NEVER run destructive/irreversible git commands (push --force, hard reset, etc.) unless explicitly requested
- NEVER skip hooks unless explicitly requested
- NEVER commit changes unless the user explicitly asks
- Avoid git commit --amend unless ALL conditions are met: (1) user requested it or pre-commit hook auto-modified files, (2) HEAD was created by you, (3) not yet pushed

Steps:
1. Run git status, git diff, and git log in parallel to understand the state.
2. Analyse changes and draft a concise commit message (focus on "why" not "what"). Do not commit files that likely contain secrets (.env, credentials.json, etc.).
3. Stage files, commit, and verify with git status.
4. If commit fails due to pre-commit hook, fix the issue and create a NEW commit.

Important:
- NEVER use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported.
- If there are no changes to commit, do not create an empty commit.
- DO NOT push to the remote repository unless the user explicitly asks.
</git_commit>

<pull_requests>
Use gh CLI for all GitHub-related tasks. When creating a PR:
1. Understand the branch state: git status, git diff, git log, git diff base...HEAD -- all in parallel.
2. Analyse ALL commits (not just the latest) and draft a PR summary.
3. Push branch with -u flag and create PR with gh pr create.
</pull_requests>

<frontend_tasks>
When doing frontend design tasks, avoid collapsing into bland, generic layouts. Aim for interfaces that feel intentional and deliberate.
- **Typography:** Use expressive, purposeful fonts and avoid default stacks (Inter, Roboto, Arial, system).
- **Colour & Look:** Choose a clear visual direction; define CSS variables; avoid purple-on-white defaults.
- **Motion:** Use a few meaningful animations (page-load, staggered reveals) instead of generic micro-motions.
- **Background:** Don't rely on flat, single-colour backgrounds; use gradients, shapes, or subtle patterns to build atmosphere.
- **Overall:** Avoid boilerplate layouts and interchangeable UI patterns. Vary themes, type families, and visual languages across outputs.
- Ensure the page loads properly on both desktop and mobile.

Exception: If working within an existing website or design system, preserve the established patterns, structure, and visual language.
</frontend_tasks>

<code_references>
When referencing specific functions or pieces of code, include the pattern [file_path:line_number](file_path:line_number) to allow the user to easily navigate to the source code location. Prefer **relative paths** (relative to project dir) for files in the project — they are shorter and easier to read.

Examples:
- `[UserService.login()](src/services/user.ts:45)`
- `[handleSubmit](components/Form.tsx:23)`
</code_references>"""


@router.post("/agents", response_model=AgentConfig)
async def create_agent(agent: AgentConfig):
    """Create a new agent"""
    if not agent.id:
        agent.id = str(uuid.uuid4())
    agent_path = os.path.join(AGENTS_DIR, agent.id)
    os.makedirs(agent_path, exist_ok=True)
    with open(os.path.join(agent_path, "config.json"), "w") as f:
        json.dump(agent.dict(exclude={"core_files"}), f, indent=4)

    # Auto-generate core files
    up = agent.user_profile or {}
    core_files = {
        "SOUL.md": f"# Personality\n\nName: {agent.name}\nVibe: {agent.vibe}\n\n{agent.description}",
        "IDENTITY.md": f"# Identity\n\nYou are {agent.name}, a specialized AI agent focused on {agent.description}.",
        "MEMORY.md": "# Memory\n\nThis file stores your long-term context and learned facts.",
        "AGENTS.md": AGENTS_MD_CONTENT,
        "USERS.md": f"# User Profile\n\n- **What to call them:** {up.get('name', 'User')}\n- **Preferred Language:** {up.get('language', 'English')}\n\n## Background\n\n{up.get('background', 'No background provided.')}"
    }

    core_dir = os.path.join(agent_path, "core")
    os.makedirs(core_dir, exist_ok=True)
    for filename, content in core_files.items():
        with open(os.path.join(core_dir, filename), "w") as f:
            f.write(content)

    return agent


@router.get("/agents", response_model=List[AgentConfig])
async def list_agents():
    """List all agents"""
    agents = []
    if os.path.exists(AGENTS_DIR):
        for aid in os.listdir(AGENTS_DIR):
            path = os.path.join(AGENTS_DIR, aid, "config.json")
            if os.path.exists(path):
                with open(path, "r") as f:
                    agents.append(json.load(f))
    return agents


@router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str):
    """Delete an agent"""
    import shutil
    path = os.path.join(AGENTS_DIR, agent_id)
    if os.path.exists(path):
        shutil.rmtree(path)
        return {"status": "success"}
    raise HTTPException(status_code=404)


# --- Agent Memories ---

@router.get("/agents/{agent_id}/memories")
async def get_memories(agent_id: str):
    """Get all memories for an agent"""
    mem = get_memory_provider(agent_id)
    return await run_in_threadpool(mem.get_all, agent_id)


@router.delete("/agents/{agent_id}/memories/{mid}")
async def delete_memory(agent_id: str, mid: str):
    """Delete a specific memory"""
    mem = get_memory_provider(agent_id)
    await run_in_threadpool(mem.delete, agent_id, mid)
    return {"status": "success"}


@router.get("/agents/{agent_id}/memories/scoped")
async def get_memories_scoped(agent_id: str):
    """Get scoped memories for an agent"""
    return get_agent_memory_by_scope(agent_id)


@router.get("/agents/{agent_id}/memories/core")
async def get_core_memory(agent_id: str):
    """Get core memory file content"""
    content = load_memory_md(agent_id)
    return {"content": content}


@router.post("/agents/{agent_id}/memories/relevant")
async def get_relevant_memories(agent_id: str, body: Dict):
    """Get memories relevant to a query"""
    from ..services.agent_runner import find_relevant_memories, _resolve_llm_config
    from openai import AsyncOpenAI
    query = body.get("query", "")
    with open(os.path.join(AGENTS_DIR, agent_id, "config.json"), "r") as f:
        config = json.load(f)
    base_url, api_key, model, fast_model = _resolve_llm_config(config)
    client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    try:
        files = await find_relevant_memories(query, agent_id, client, fast_model)
        return {"files": [{"name": fname, "preview": content[:300]} for fname, content in files]}
    finally:
        await client.close()


# --- Agent Todos ---

@router.get("/agents/{agent_id}/todos")
async def get_agent_todos(agent_id: str):
    """Get todos for an agent"""
    return {"todos": get_todos(agent_id)}


@router.put("/agents/{agent_id}/todos")
async def replace_agent_todos(agent_id: str, body: Dict):
    """Replace all todos for an agent"""
    todos = body.get("todos", [])
    set_todos(agent_id, todos)
    return {"todos": todos}


@router.patch("/agents/{agent_id}/todos/{todo_id}")
async def update_agent_todo(agent_id: str, todo_id: str, body: Dict):
    """Update a specific todo"""
    todos = get_todos(agent_id)
    for todo in todos:
        if todo.get("id") == todo_id:
            todo.update(body)
            break
    set_todos(agent_id, todos)
    return {"todos": todos}


# --- Agent Core Files ---

@router.get("/agents/{agent_id}/core_files")
async def list_agent_core_files(agent_id: str):
    """List all core files for an agent"""
    agent_path = os.path.join(AGENTS_DIR, agent_id)
    core_dir = os.path.join(agent_path, "core")
    if not os.path.exists(core_dir):
        return {}
    files = {}
    for f in os.listdir(core_dir):
        if f.endswith(".md"):
            with open(os.path.join(core_dir, f), "r") as file:
                files[f] = file.read()
    return files


@router.get("/agents/{agent_id}/core_files/{filename}")
async def get_agent_core_file(agent_id: str, filename: str):
    """Get a specific core file"""
    path = os.path.join(AGENTS_DIR, agent_id, "core", filename)
    if os.path.exists(path):
        with open(path, "r") as f:
            return {"content": f.read()}
    raise HTTPException(status_code=404)


@router.put("/agents/{agent_id}/core_files/{filename}")
async def update_agent_core_file(agent_id: str, filename: str, content: Dict):
    """Update a core file"""
    path = os.path.join(AGENTS_DIR, agent_id, "core", filename)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content.get("content", ""))
    return {"status": "success"}


# --- Agent Tasks ---

@router.get("/agents/{agent_id}/prompt")
async def get_prompt(agent_id: str):
    """Get agent prompt"""
    return await get_agent_prompt(agent_id)


@router.post("/agents/{agent_id}/run_stream")
async def run_stream(agent_id: str, request: TaskRequest):
    """Run agent task with streaming response"""
    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        stream_agent_task(agent_id, request),
        media_type="text/event-stream",
    )
