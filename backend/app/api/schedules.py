import os
import json
import uuid
from typing import Dict
from datetime import datetime
from fastapi import APIRouter, HTTPException

from ..models.schemas import Schedule
from ..services.settings import SCHEDULES_DIR, MESSAGES_DIR, AGENTS_DIR
from ..services.agent_runner import run_agent_task
from ..models.schemas import TaskRequest

router = APIRouter()


@router.get("/schedules")
async def list_schedules():
    """List all schedules"""
    items = []
    if os.path.exists(SCHEDULES_DIR):
        for f in os.listdir(SCHEDULES_DIR):
            if f.endswith(".json"):
                with open(os.path.join(SCHEDULES_DIR, f), "r") as file:
                    items.append(json.load(file))
    return items


@router.post("/schedules")
async def create_schedule(s: Schedule):
    """Create a new schedule"""
    if not s.id:
        s.id = str(uuid.uuid4())
    with open(os.path.join(SCHEDULES_DIR, f"{s.id}.json"), "w") as f:
        json.dump(s.dict(), f, indent=4)
    return s


@router.delete("/schedules/{sid}")
async def delete_schedule(sid: str):
    """Delete a schedule"""
    p = os.path.join(SCHEDULES_DIR, f"{sid}.json")
    if os.path.exists(p):
        os.remove(p)
        return {"status": "deleted"}
    raise HTTPException(status_code=404)


@router.patch("/schedules/{sid}")
async def update_schedule(sid: str, updates: Dict):
    """Update a schedule"""
    p = os.path.join(SCHEDULES_DIR, f"{sid}.json")
    with open(p, "r") as f:
        data = json.load(f)
    data.update(updates)
    with open(p, "w") as f:
        json.dump(data, f, indent=4)
    return data


@router.post("/schedules/{sid}/run")
async def run_schedule_now(sid: str):
    """Run a schedule immediately"""
    p = os.path.join(SCHEDULES_DIR, f"{sid}.json")
    if not os.path.exists(p):
        raise HTTPException(status_code=404)
    with open(p, "r") as f:
        s = json.load(f)
    try:
        s["last_run_status"] = "Running..."
        with open(p, "w") as f:
            json.dump(s, f, indent=4)

        res = await run_agent_task(s["target_id"], TaskRequest(message=s["task"]))
        cid = s["target_id"]

        # Save messages
        from ..api.messages import save_message
        await save_message(cid, {
            "id": f"s-{uuid.uuid4()}",
            "sender_id": "System",
            "receiver_id": cid,
            "type": "TASK_ASSIGN",
            "payload": {"content": f"[Scheduled] {s['name']}: {s['task']}"},
            "context_metadata": {"conversation_id": cid}
        })
        await save_message(cid, {
            "id": f"sr-{uuid.uuid4()}",
            "sender_id": s["target_id"],
            "receiver_id": "User",
            "type": "FEEDBACK",
            "payload": {"content": res["content"]},
            "context_metadata": {"conversation_id": cid}
        })

        s["last_run_status"] = "Success"
        try:
            from croniter import croniter
            s["next_run_time"] = croniter(s['cron'], datetime.now()).get_next(datetime).strftime("%Y-%m-%d %H:%M:%S")
        except:
            pass
        with open(p, "w") as f:
            json.dump(s, f, indent=4)
        return {"status": "completed"}
    except Exception as e:
        s["last_run_status"] = f"Failed: {str(e)}"
        with open(p, "w") as f:
            json.dump(s, f, indent=4)
        return {"status": "failed"}
