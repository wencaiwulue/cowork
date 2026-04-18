import os
import json
import uuid
from typing import Dict
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..models.schemas import TaskRequest, OrchestrationNode
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


class StreamRequest(TaskRequest):
    """Request model for message stream"""
    type: str  # "team" or "agent"
    team_name: str = ""
    agent_id: str = ""


@router.get("/messages/{cid}")
async def get_messages(cid: str):
    """Get messages for a conversation"""
    path = os.path.join(MESSAGES_DIR, f"{cid}.json")
    if os.path.exists(path):
        with open(path, "r") as f:
            return json.load(f)
    return []


@router.post("/messages/{cid}")
async def save_message(cid: str, m: Dict):
    """Save a message to a conversation"""
    path = os.path.join(MESSAGES_DIR, f"{cid}.json")
    ms = []
    if os.path.exists(path):
        try:
            with open(path, "r") as f:
                ms = json.load(f)
        except:
            pass
    ms.append(m)
    with open(path, "w") as f:
        json.dump(ms[-100:], f, indent=4)
    return {"status": "saved"}


@router.post("/messages/{convo_id}/stream")
async def message_stream(convo_id: str, request: StreamRequest, use_langchain: bool = True):
    """Stream messages for a conversation"""
    async def generate():
        try:
            if request.type == "team":
                plan, context, agents_map = _load_team_context(request.team_name)

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
                        yield f"data: {json.dumps(event)}\n\n"

                    yield f"data: {json.dumps({'orchestration_done': True, 'trace_id': trace_id})}\n\n"
                else:
                    # Use traditional orchestrator
                    async for line in OrchestrationService.stream_plan(
                        plan, request.message, request.history or [], context, agents_map
                    ):
                        yield line
            else:
                from ..services.agent_runner import stream_agent_task
                tr = TaskRequest(message=request.message, history=request.history)
                async for line in stream_agent_task(request.agent_id, tr):
                    yield line
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        finally:
            yield f"data: {json.dumps({'stream_done': True})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
