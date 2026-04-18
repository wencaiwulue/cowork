import os
import json
import uuid
import time
from typing import Dict
from fastapi import APIRouter

from ..services.settings import SESSIONS_DIR, MESSAGES_DIR

router = APIRouter()


@router.get("/sessions")
async def list_sessions():
    """List all sessions"""
    items = []
    if os.path.exists(SESSIONS_DIR):
        for f in os.listdir(SESSIONS_DIR):
            if f.endswith(".json"):
                with open(os.path.join(SESSIONS_DIR, f), "r") as file:
                    items.append(json.load(file))
    return sorted(items, key=lambda x: x.get('created_at', 0), reverse=True)


@router.post("/sessions")
async def create_session(s: Dict):
    """Create a new session"""
    if "id" not in s:
        s["id"] = str(uuid.uuid4())
    if "created_at" not in s:
        s["created_at"] = time.time()
    with open(os.path.join(SESSIONS_DIR, f"{s['id']}.json"), "w") as f:
        json.dump(s, f, indent=4)
    return s


@router.delete("/sessions/{sid}")
async def delete_session(sid: str):
    """Delete a session"""
    p = os.path.join(SESSIONS_DIR, f"{sid}.json")
    if os.path.exists(p):
        os.remove(p)
        mp = os.path.join(MESSAGES_DIR, f"{sid}.json")
        if os.path.exists(mp):
            os.remove(mp)
        return {"status": "deleted"}
    from fastapi import HTTPException
    raise HTTPException(status_code=404)
