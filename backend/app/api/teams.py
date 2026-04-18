import os
import json
import uuid
from typing import Dict
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..models.schemas import TeamConfig, TaskRequest, OrchestrationNode
from ..services.settings import AGENTS_DIR, TEAMS_DIR, MESSAGES_DIR
from ..services.orchestrator import OrchestrationService

router = APIRouter()

# LangChain orchestrator (will be set from main.py)
langchain_orchestrator = None


def set_langchain_orchestrator(orchestrator):
    """Set the LangChain orchestrator instance"""
    global langchain_orchestrator
    langchain_orchestrator = orchestrator


def _load_team_context(team_name: str):
    """Load team data and build context dict + OrchestrationNode + agents_map."""
    path = os.path.join(TEAMS_DIR, f"{team_name}.json")
    if not os.path.exists(path):
        raise HTTPException(status_code=404)
    with open(path, "r") as f:
        team_data = json.load(f)
    plan_data = team_data.get("orchestration_plan") or {"mode": "supervisor", "agents": team_data["agents"]}
    plan = OrchestrationNode(**plan_data)
    members = []
    agents_map = {}
    for aid in team_data["agents"]:
        cp = os.path.join(AGENTS_DIR, aid, "config.json")
        if os.path.exists(cp):
            with open(cp, "r") as f:
                ac = json.load(f)
            members.append({
                "id": aid,
                "name": ac["name"],
                "description": ac["description"],
                "skills": ac.get("skills", []),
                "is_tl": aid == team_data.get("tl_id")
            })
            agents_map[aid] = {"name": ac["name"], "avatar": ac.get("avatar", "🤖")}
    context = {
        "team_name": team_name,
        "members": members,
        "tl_id": team_data.get("tl_id")
    }
    return plan, context, agents_map


@router.get("/teams")
async def list_teams():
    """List all teams"""
    teams = []
    if os.path.exists(TEAMS_DIR):
        for f in os.listdir(TEAMS_DIR):
            if f.endswith(".json"):
                with open(os.path.join(TEAMS_DIR, f), "r") as file:
                    teams.append(json.load(file))
    return teams


@router.post("/teams")
async def create_team(team: TeamConfig):
    """Create a new team"""
    with open(os.path.join(TEAMS_DIR, f"{team.name}.json"), "w") as f:
        json.dump(team.dict(), f, indent=4)
    return {"status": "success"}


@router.delete("/teams/{team_name}")
async def delete_team(team_name: str):
    """Delete a team"""
    path = os.path.join(TEAMS_DIR, f"{team_name}.json")
    if os.path.exists(path):
        os.remove(path)
        mpath = os.path.join(MESSAGES_DIR, f"{team_name}.json")
        if os.path.exists(mpath):
            os.remove(mpath)
        return {"status": "success"}
    raise HTTPException(status_code=404)


@router.put("/teams/{old_name}/rename")
async def rename_team(old_name: str, new_name: str):
    """Rename a team"""
    old_p = os.path.join(TEAMS_DIR, f"{old_name}.json")
    new_p = os.path.join(TEAMS_DIR, f"{new_name}.json")
    if os.path.exists(old_p):
        with open(old_p, "r") as f:
            data = json.load(f)
        data["name"] = new_name
        with open(new_p, "w") as f:
            json.dump(data, f, indent=4)
        os.remove(old_p)
        om = os.path.join(MESSAGES_DIR, f"{old_name}.json")
        if os.path.exists(om):
            os.rename(om, os.path.join(MESSAGES_DIR, f"{new_name}.json"))
        return {"status": "success"}
    raise HTTPException(status_code=404)


@router.post("/teams/{team_name}/run")
async def run_team_task(team_name: str, request: TaskRequest, use_langchain: bool = True):
    """Run a task with the team"""
    plan, context, agents_map = _load_team_context(team_name)
    try:
        if use_langchain and langchain_orchestrator:
            # Use LangChain orchestrator
            trace_id = str(uuid.uuid4())

            result = await langchain_orchestrator.run_team_task(
                node=plan,
                user_message=request.message,
                history=request.history or [],
                team_context=context,
                agents_map=agents_map,
                trace_id=trace_id,
            )
            return {"content": result.get("final", ""), "trace_id": trace_id}
        else:
            # Use traditional orchestrator
            content = await OrchestrationService.execute_plan(
                plan, request.message, request.history or [], context
            )
            return {"content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Team Orchestration Error: {str(e)}")


@router.post("/teams/{team_name}/run_stream")
async def run_team_task_stream(team_name: str, request: TaskRequest, use_langchain: bool = True):
    """Run a task with the team and stream the response"""
    plan, context, agents_map = _load_team_context(team_name)

    async def generate():
        if use_langchain and langchain_orchestrator:
            # Use LangChain orchestrator
            trace_id = str(uuid.uuid4())

            async for event in langchain_orchestrator.stream_team_task(
                node=plan,
                user_message=request.message,
                history=request.history or [],
                team_context=context,
                agents_map=agents_map,
                trace_id=trace_id,
            ):
                # Convert to SSE format
                yield f"data: {json.dumps(event)}\n\n"

            yield f"data: {json.dumps({'orchestration_done': True, 'trace_id': trace_id})}\n\n"
        else:
            # Use traditional orchestrator
            async for line in OrchestrationService.stream_plan(
                plan, request.message, request.history or [], context, agents_map
            ):
                yield line

    return StreamingResponse(generate(), media_type="text/event-stream")
