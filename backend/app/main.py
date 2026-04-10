import os
import json
import uuid
import httpx
from typing import List, Optional, Dict
from fastapi import FastAPI, HTTPException, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.concurrency import run_in_threadpool

from .models.schemas import AgentConfig, TeamConfig, TaskRequest, Schedule, OrchestrationNode
from .services.settings import DATA_DIR, AGENTS_DIR, TEAMS_DIR, SKILLS_DIR, SKILLHUB_DIR, SCHEDULES_DIR, MESSAGES_DIR, SESSIONS_DIR, get_settings, save_settings
from .services.agent_runner import run_agent_task_logic, get_agent_prompt, run_agent_task
from .services.memory import get_memory_provider
from .services.orchestrator import OrchestrationService

app = FastAPI(title="Agent Platform API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

@app.get("/settings")
async def get_settings_api(): return get_settings()

@app.post("/settings")
async def save_settings_api(settings: Dict):
    save_settings(settings)
    return settings

# --- Agents ---

@app.post("/agents", response_model=AgentConfig)
async def create_agent(agent: AgentConfig):
    if not agent.id: agent.id = str(uuid.uuid4())
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

@app.get("/agents", response_model=List[AgentConfig])
async def list_agents():
    agents = []
    if os.path.exists(AGENTS_DIR):
        for aid in os.listdir(AGENTS_DIR):
            path = os.path.join(AGENTS_DIR, aid, "config.json")
            if os.path.exists(path):
                with open(path, "r") as f: agents.append(json.load(f))
    return agents

@app.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str):
    import shutil
    path = os.path.join(AGENTS_DIR, agent_id)
    if os.path.exists(path):
        shutil.rmtree(path)
        return {"status": "success"}
    raise HTTPException(status_code=404)

@app.get("/agents/{agent_id}/memories")
async def get_memories(agent_id: str):
    mem = get_memory_provider(agent_id)
    return mem.get_all(agent_id)

@app.delete("/agents/{agent_id}/memories/{mid}")
async def delete_memory(agent_id: str, mid: str):
    mem = get_memory_provider(agent_id)
    mem.delete(agent_id, mid)
    return {"status": "success"}

@app.get("/agents/{agent_id}/core_files")
async def list_agent_core_files(agent_id: str):
    agent_path = os.path.join(AGENTS_DIR, agent_id)
    core_dir = os.path.join(agent_path, "core")
    if not os.path.exists(core_dir): return {}
    files = {}
    for f in os.listdir(core_dir):
        if f.endswith(".md"):
            with open(os.path.join(core_dir, f), "r") as file: files[f] = file.read()
    return files

@app.get("/agents/{agent_id}/core_files/{filename}")
async def get_agent_core_file(agent_id: str, filename: str):
    path = os.path.join(AGENTS_DIR, agent_id, "core", filename)
    if os.path.exists(path):
        with open(path, "r") as f: return {"content": f.read()}
    raise HTTPException(status_code=404)

@app.put("/agents/{agent_id}/core_files/{filename}")
async def update_agent_core_file(agent_id: str, filename: str, content: Dict):
    path = os.path.join(AGENTS_DIR, agent_id, "core", filename)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f: f.write(content.get("content", ""))
    return {"status": "success"}

@app.get("/agents/{agent_id}/prompt")
async def get_prompt(agent_id: str): return await get_agent_prompt(agent_id)

@app.post("/agents/{agent_id}/run_stream")
async def run_stream(agent_id: str, request: TaskRequest):
    try:
        client, model, messages, mem = await run_agent_task_logic(agent_id, request)
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))
    
    async def stream_generator():
        full_content = ""
        try:
            stream = await client.chat.completions.create(model=model, messages=messages, stream=True)
            async for chunk in stream:
                if chunk.choices:
                    delta = chunk.choices[0].delta
                    content = getattr(delta, "content", None) or ""
                    reasoning = getattr(delta, "reasoning_content", None) or ""
                    if content or reasoning:
                        full_content += content
                        yield f"data: {json.dumps({'content': content, 'reasoning': reasoning})}\n\n"
            if full_content.strip():
                await run_in_threadpool(mem.add, f"User: {request.message}\nAssistant: {full_content}", user_id=agent_id)
            yield "data: [DONE]\n\n"
        except Exception as e: yield f"data: {json.dumps({'error': str(e)})}\n\n"
        finally: await client.close()
    return StreamingResponse(stream_generator(), media_type="text/event-stream")

# --- Teams ---

@app.get("/teams")
async def list_teams():
    teams = []
    if os.path.exists(TEAMS_DIR):
        for f in os.listdir(TEAMS_DIR):
            if f.endswith(".json"):
                with open(os.path.join(TEAMS_DIR, f), "r") as file: teams.append(json.load(file))
    return teams

@app.post("/teams")
async def create_team(team: TeamConfig):
    with open(os.path.join(TEAMS_DIR, f"{team.name}.json"), "w") as f: json.dump(team.dict(), f, indent=4)
    return {"status": "success"}

@app.post("/teams/{team_name}/run")
async def run_team_task(team_name: str, request: TaskRequest):
    path = os.path.join(TEAMS_DIR, f"{team_name}.json")
    if not os.path.exists(path): raise HTTPException(status_code=404)
    with open(path, "r") as f: team_data = json.load(f)
    plan_data = team_data.get("orchestration_plan") or {"mode": "supervisor", "agents": team_data["agents"]}
    plan = OrchestrationNode(**plan_data)
    members = []
    for aid in team_data["agents"]:
        cp = os.path.join(AGENTS_DIR, aid, "config.json")
        if os.path.exists(cp):
            with open(cp, "r") as f:
                ac = json.load(f)
                members.append({"id": aid, "name": ac["name"], "description": ac["description"], "skills": ac["skills"], "is_tl": aid == team_data.get("tl_id")})
    context = {"team_name": team_name, "members": members, "tl_id": team_data.get("tl_id")}
    try:
        content = await OrchestrationService.execute_plan(plan, request.message, request.history, context)
        return {"content": content}
    except Exception as e: raise HTTPException(status_code=500, detail=f"Team Orchestration Error: {str(e)}")

@app.delete("/teams/{team_name}")
async def delete_team(team_name: str):
    path = os.path.join(TEAMS_DIR, f"{team_name}.json")
    if os.path.exists(path):
        os.remove(path)
        mpath = os.path.join(MESSAGES_DIR, f"{team_name}.json")
        if os.path.exists(mpath): os.remove(mpath)
        return {"status": "success"}
    raise HTTPException(status_code=404)

@app.put("/teams/{old_name}/rename")
async def rename_team(old_name: str, new_name: str):
    old_p = os.path.join(TEAMS_DIR, f"{old_name}.json")
    new_p = os.path.join(TEAMS_DIR, f"{new_name}.json")
    if os.path.exists(old_p):
        with open(old_p, "r") as f: data = json.load(f)
        data["name"] = new_name
        with open(new_p, "w") as f: json.dump(data, f, indent=4)
        os.remove(old_p)
        om = os.path.join(MESSAGES_DIR, f"{old_name}.json")
        if os.path.exists(om): os.rename(om, os.path.join(MESSAGES_DIR, f"{new_name}.json"))
        return {"status": "success"}
    raise HTTPException(status_code=404)

# --- SkillHub ---

@app.get("/skillhub")
async def list_skillhub(q: Optional[str] = None):
    settings = get_settings()
    repo_url = settings.get("skillhub_repo", "https://skillsmp.com")
    hub_skills = []
    try:
        async with httpx.AsyncClient() as client:
            api_url = repo_url.rstrip('/')
            if "skillsmp.com" in api_url:
                api_url = "https://skillsmp.com/api/skills"
            res = await client.get(api_url, timeout=3.0)
            if res.status_code == 200: hub_skills = res.json()
    except: pass
    
    defaults = [
        {"id": "sh-1", "name": "Web Scraper", "description": "Extract content from any website.", "icon": "🌐"},
        {"id": "sh-2", "name": "Python Data Scientist", "description": "Run complex data analysis.", "icon": "🐍"},
        {"id": "sh-3", "name": "Image Generator", "description": "Create visuals from text.", "icon": "🎨"},
        {"id": "sh-4", "name": "Financial Analyst", "description": "Stock market and crypto analysis.", "icon": "📈"},
        {"id": "sh-5", "name": "Code Auditor", "description": "Security and performance reviews.", "icon": "🛡️"}
    ]
    local_ids = {s['id'] for s in hub_skills}
    for s in defaults:
        if s['id'] not in local_ids: hub_skills.append(s)
    if q:
        q = q.lower()
        hub_skills = [s for s in hub_skills if q in s['name'].lower() or q in s.get('description', '').lower()]
    return hub_skills

@app.post("/skills/install")
async def install_skill(skill_id: str): return {"status": "installed"}

# --- Sessions ---

@app.get("/sessions")
async def list_sessions():
    items = []
    if os.path.exists(SESSIONS_DIR):
        for f in os.listdir(SESSIONS_DIR):
            if f.endswith(".json"):
                with open(os.path.join(SESSIONS_DIR, f), "r") as file: items.append(json.load(file))
    return sorted(items, key=lambda x: x.get('created_at', 0), reverse=True)

@app.post("/sessions")
async def create_session(s: Dict):
    if "id" not in s: s["id"] = str(uuid.uuid4())
    if "created_at" not in s: import time; s["created_at"] = time.time()
    with open(os.path.join(SESSIONS_DIR, f"{s['id']}.json"), "w") as f: json.dump(s, f, indent=4)
    return s

@app.delete("/sessions/{sid}")
async def delete_session(sid: str):
    p = os.path.join(SESSIONS_DIR, f"{sid}.json")
    if os.path.exists(p):
        os.remove(p)
        mp = os.path.join(MESSAGES_DIR, f"{sid}.json")
        if os.path.exists(mp): os.remove(mp)
        return {"status": "deleted"}
    raise HTTPException(status_code=404)

@app.get("/messages/{cid}")
async def get_messages(cid: str):
    path = os.path.join(MESSAGES_DIR, f"{cid}.json")
    if os.path.exists(path):
        with open(path, "r") as f: return json.load(f)
    return []

@app.post("/messages/{cid}")
async def save_message(cid: str, m: Dict):
    path = os.path.join(MESSAGES_DIR, f"{cid}.json")
    ms = []
    if os.path.exists(path):
        try:
            with open(path, "r") as f: ms = json.load(f)
        except: pass
    ms.append(m)
    with open(path, "w") as f: json.dump(ms[-100:], f, indent=4)
    return {"status": "saved"}

# --- Schedules ---

@app.get("/schedules")
async def list_schedules():
    items = []
    if os.path.exists(SCHEDULES_DIR):
        for f in os.listdir(SCHEDULES_DIR):
            if f.endswith(".json"):
                with open(os.path.join(SCHEDULES_DIR, f), "r") as file: items.append(json.load(file))
    return items

@app.post("/schedules")
async def create_schedule(s: Schedule):
    if not s.id: s.id = str(uuid.uuid4())
    with open(os.path.join(SCHEDULES_DIR, f"{s.id}.json"), "w") as f: json.dump(s.dict(), f, indent=4)
    return s

@app.delete("/schedules/{sid}")
async def delete_schedule(sid: str):
    p = os.path.join(SCHEDULES_DIR, f"{sid}.json")
    if os.path.exists(p): os.remove(p); return {"status": "deleted"}
    raise HTTPException(status_code=404)

@app.patch("/schedules/{sid}")
async def update_schedule(sid: str, updates: Dict):
    p = os.path.join(SCHEDULES_DIR, f"{sid}.json")
    with open(p, "r") as f: data = json.load(f)
    data.update(updates)
    with open(p, "w") as f: json.dump(data, f, indent=4)
    return data

@app.post("/schedules/{sid}/run")
async def run_schedule_now(sid: str):
    p = os.path.join(SCHEDULES_DIR, f"{sid}.json")
    if not os.path.exists(p): raise HTTPException(status_code=404)
    with open(p, "r") as f: s = json.load(f)
    try:
        s["last_run_status"] = "Running..."
        with open(p, "w") as f: json.dump(s, f, indent=4)
        from .models.schemas import TaskRequest
        res = await run_agent_task(s["target_id"], TaskRequest(message=s["task"]))
        cid = s["target_id"]
        await save_message(cid, {"id": f"s-{uuid.uuid4()}", "sender_id": "System", "receiver_id": cid, "type": "TASK_ASSIGN", "payload": {"content": f"[Scheduled] {s['name']}: {s['task']}"}, "context_metadata": {"conversation_id": cid}})
        await save_message(cid, {"id": f"sr-{uuid.uuid4()}", "sender_id": s["target_id"], "receiver_id": "User", "type": "FEEDBACK", "payload": {"content": res["content"]}, "context_metadata": {"conversation_id": cid}})
        s["last_run_status"] = "Success"
        try:
            from croniter import croniter
            from datetime import datetime
            s["next_run_time"] = croniter(s['cron'], datetime.now()).get_next(datetime).strftime("%Y-%m-%d %H:%M:%S")
        except: pass
        with open(p, "w") as f: json.dump(s, f, indent=4)
        return {"status": "completed"}
    except Exception as e:
        s["last_run_status"] = f"Failed: {str(e)}"
        with open(p, "w") as f: json.dump(s, f, indent=4)
        return {"status": "failed"}

@app.get("/files")
async def list_files(path: str = "."):
    bp = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    tp = os.path.abspath(os.path.join(bp, path))
    if not tp.startswith(bp): raise HTTPException(status_code=403)
    if not os.path.exists(tp): return []
    fs = []
    for e in os.scandir(tp):
        if e.name.startswith(('.', 'node_modules', '__pycache__', 'dist', 'dist-electron')): continue
        st = e.stat()
        fs.append({"name": e.name, "is_dir": e.is_dir(), "modified": st.st_mtime, "size": st.st_size, "path": os.path.relpath(e.path, bp)})
    return sorted(fs, key=lambda x: (not x["is_dir"], x["name"]))
