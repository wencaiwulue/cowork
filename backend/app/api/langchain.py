import json
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# LangChain orchestrator (will be set from main.py)
langchain_orchestrator = None


def set_langchain_orchestrator(orchestrator):
    """Set the LangChain orchestrator instance"""
    global langchain_orchestrator
    langchain_orchestrator = orchestrator


router = APIRouter()


class ToolCreateRequest(BaseModel):
    name: str
    description: str
    tool_type: str = "function"
    enabled: bool = True


class SkillCreateRequest(BaseModel):
    name: str
    description: str
    version: str = "1.0.0"
    chain_type: str = "sequential"
    enabled: bool = True


class RAGConfigCreateRequest(BaseModel):
    name: str
    description: str
    enabled: bool = True


# --- Health Check ---

@router.get("/langchain/health")
async def langchain_health():
    """Get LangChain orchestrator health status"""
    if not langchain_orchestrator:
        raise HTTPException(status_code=503, detail="LangChain orchestrator not initialized")
    return await langchain_orchestrator.health_check()


# --- Tools ---

@router.get("/langchain/tools")
async def list_tools():
    """List all available tools"""
    if not langchain_orchestrator:
        raise HTTPException(status_code=503, detail="LangChain orchestrator not initialized")
    return {"tools": langchain_orchestrator.get_tools()}


@router.post("/langchain/tools")
async def create_tool(request: ToolCreateRequest):
    """Register a new tool"""
    if not langchain_orchestrator:
        raise HTTPException(status_code=503, detail="LangChain orchestrator not initialized")
    tool = langchain_orchestrator.register_tool(
        name=request.name,
        description=request.description,
        tool_type=request.tool_type,
        enabled=request.enabled
    )
    return {"tool": tool}


@router.delete("/langchain/tools/{tool_name}")
async def delete_tool(tool_name: str):
    """Unregister a tool"""
    if not langchain_orchestrator:
        raise HTTPException(status_code=503, detail="LangChain orchestrator not initialized")
    success = langchain_orchestrator.unregister_tool(tool_name)
    if not success:
        raise HTTPException(status_code=404, detail="Tool not found")
    return {"status": "deleted"}


# --- Skills ---

@router.get("/langchain/skills")
async def list_skills():
    """List all registered skills"""
    if not langchain_orchestrator:
        raise HTTPException(status_code=503, detail="LangChain orchestrator not initialized")
    return {"skills": langchain_orchestrator.get_skills()}


@router.post("/langchain/skills")
async def create_skill(request: SkillCreateRequest):
    """Register a new skill"""
    if not langchain_orchestrator:
        raise HTTPException(status_code=503, detail="LangChain orchestrator not initialized")
    skill = langchain_orchestrator.register_skill(
        name=request.name,
        description=request.description,
        version=request.version,
        chain_type=request.chain_type,
        enabled=request.enabled
    )
    return {"skill": skill}


@router.delete("/langchain/skills/{skill_id}")
async def delete_skill(skill_id: str):
    """Unregister a skill"""
    if not langchain_orchestrator:
        raise HTTPException(status_code=503, detail="LangChain orchestrator not initialized")
    success = langchain_orchestrator.unregister_skill(skill_id)
    if not success:
        raise HTTPException(status_code=404, detail="Skill not found")
    return {"status": "deleted"}


# --- RAG Configs ---

@router.get("/langchain/rag/configs")
async def list_rag_configs():
    """List all RAG configurations"""
    if not langchain_orchestrator:
        raise HTTPException(status_code=503, detail="LangChain orchestrator not initialized")
    return {"configs": langchain_orchestrator.get_rag_configs()}


@router.post("/langchain/rag/configs")
async def create_rag_config(request: RAGConfigCreateRequest):
    """Create a new RAG configuration"""
    if not langchain_orchestrator:
        raise HTTPException(status_code=503, detail="LangChain orchestrator not initialized")
    config = langchain_orchestrator.create_rag_config(
        name=request.name,
        description=request.description,
        enabled=request.enabled
    )
    return {"config": config}


@router.delete("/langchain/rag/configs/{config_id}")
async def delete_rag_config(config_id: str):
    """Delete a RAG configuration"""
    if not langchain_orchestrator:
        raise HTTPException(status_code=503, detail="LangChain orchestrator not initialized")
    success = langchain_orchestrator.delete_rag_config(config_id)
    if not success:
        raise HTTPException(status_code=404, detail="Config not found")
    return {"status": "deleted"}


# --- Traces ---

@router.get("/langchain/traces")
async def list_traces(limit: int = 50, offset: int = 0):
    """List recent traces"""
    if not langchain_orchestrator:
        raise HTTPException(status_code=503, detail="LangChain orchestrator not initialized")
    return {"traces": langchain_orchestrator.get_traces(limit, offset)}


@router.get("/langchain/traces/{trace_id}")
async def get_trace(trace_id: str):
    """Get a specific trace by ID"""
    if not langchain_orchestrator:
        raise HTTPException(status_code=503, detail="LangChain orchestrator not initialized")
    trace = langchain_orchestrator.get_trace(trace_id)
    if not trace:
        raise HTTPException(status_code=404, detail="Trace not found")
    return {"trace": trace}
