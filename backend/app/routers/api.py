"""
API routes for agent collaboration.
"""

import os
import json
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse

from app.models.schemas import AgentInfo, MessageCreate, Message, ChatRequest, ChatResponse
from app.services.memory import memory_service
from app.services.langchain_services import langchain_service

router = APIRouter(prefix="/api", tags=["api"])

# Data directory for persistence
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")
AGENTS_DIR = os.path.join(DATA_DIR, "agents")


def ensure_dirs():
    """Ensure data directories exist."""
    os.makedirs(AGENTS_DIR, exist_ok=True)


def get_agent_path(agent_id: str) -> str:
    """Get the file path for an agent's configuration."""
    return os.path.join(AGENTS_DIR, f"{agent_id}.json")


def save_agent_info(agent: AgentInfo):
    """Save agent info to file."""
    ensure_dirs()
    path = get_agent_path(agent.id)
    with open(path, "w") as f:
        json.dump(agent.model_dump(), f, indent=2)


def load_agent_info(agent_id: str) -> Optional[AgentInfo]:
    """Load agent info from file."""
    path = get_agent_path(agent_id)
    if os.path.exists(path):
        with open(path, "r") as f:
            data = json.load(f)
            return AgentInfo(**data)
    return None


@router.post("/agents")
async def create_agent(agent: AgentInfo) -> AgentInfo:
    """Create a new agent."""
    if not agent.id:
        agent.id = str(uuid.uuid4())
    save_agent_info(agent)
    return agent


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str) -> AgentInfo:
    """Get agent information."""
    agent = load_agent_info(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.put("/agents/{agent_id}")
async def update_agent(agent_id: str, agent: AgentInfo) -> AgentInfo:
    """Update agent information."""
    existing = load_agent_info(agent_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent.id = agent_id
    save_agent_info(agent)
    return agent


@router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str):
    """Delete an agent."""
    path = get_agent_path(agent_id)
    if os.path.exists(path):
        os.remove(path)
    return {"status": "deleted"}


@router.get("/agents")
async def list_agents() -> list[AgentInfo]:
    """List all available agents."""
    ensure_dirs()
    agents = []
    for filename in os.listdir(AGENTS_DIR):
        if filename.endswith(".json"):
            agent_id = filename[:-5]
            agent = load_agent_info(agent_id)
            if agent:
                agents.append(agent)
    return agents


# Thread management endpoints

@router.post("/agents/{agent_id}/threads")
async def create_thread(agent_id: str):
    """Create a new conversation thread for an agent."""
    agent = load_agent_info(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    thread_id = memory_service.create_conversation(agent_id)
    return {"thread_id": thread_id, "agent_id": agent_id}


@router.get("/threads/{thread_id}/messages")
async def get_messages(thread_id: str, limit: int = 100) -> list[Message]:
    """Get messages for a conversation thread."""
    messages = memory_service.get_messages(thread_id, limit)
    return messages


@router.delete("/threads/{thread_id}/messages")
async def clear_messages(thread_id: str):
    """Clear all messages in a thread."""
    success = memory_service.clear_messages(thread_id)
    return {"status": "cleared" if success else "error"}


# Chat endpoints

@router.post("/agents/{agent_id}/chat")
async def chat_with_agent(agent_id: str, request: ChatRequest) -> ChatResponse:
    """Send a message to an agent and get a response."""
    agent = load_agent_info(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Create thread if not provided
    thread_id = request.thread_id
    if not thread_id:
        thread_id = memory_service.create_conversation(agent_id)

    # Get response from LangChain service
    message = MessageCreate(content=request.content)
    response = await langchain_service.chat(message, agent, thread_id)

    return ChatResponse(
        message=response,
        thread_id=thread_id,
    )


@router.post("/agents/{agent_id}/stream")
async def stream_chat_with_agent(agent_id: str, request: ChatRequest):
    """Stream a chat response from an agent."""
    agent = load_agent_info(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    async def generate():
        # For now, just return the complete response
        # Streaming can be implemented with langchain callbacks
        message = MessageCreate(content=request.content)

        # Create thread if not provided
        thread_id = request.thread_id
        if not thread_id:
            thread_id = memory_service.create_conversation(agent_id)

        response = await langchain_service.chat(message, agent, thread_id)

        yield f"data: {json.dumps({'type': 'start', 'thread_id': thread_id})}\n\n"
        yield f"data: {json.dumps({'type': 'content', 'content': response.content})}\n\n"
        yield f"data: {json.dumps({'type': 'end', 'message': response.model_dump()})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@router.post("/threads/{thread_id}/messages")
async def add_message_to_thread(thread_id: str, message: MessageCreate, agent_id: Optional[str] = None) -> Message:
    """Add a message to a specific thread."""
    agent_info = None
    if agent_id:
        agent_info = load_agent_info(agent_id)

    saved_message = memory_service.add_message(thread_id, message, agent_info)
    return saved_message
