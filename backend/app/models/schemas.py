from pydantic import BaseModel
from typing import List, Optional, Dict

class AgentConfig(BaseModel):
    id: Optional[str] = None
    name: str
    description: str
    vibe: str
    avatar: str
    tools: List[str]
    skills: List[str]
    llm: Optional[Dict[str, str]] = None
    user_profile: Optional[Dict[str, str]] = None
    core_files: Optional[Dict[str, str]] = None

class OrchestrationNode(BaseModel):
    mode: str  # "supervisor", "pipeline", "parallel", "reflection", "debate"
    agents: List[str]  # Agent IDs involved in this node
    children: Optional[List['OrchestrationNode']] = None
    config: Optional[Dict] = None  # Specific settings like max_loops

class TeamConfig(BaseModel):
    name: str
    agents: List[str]
    tl_id: Optional[str] = None
    orchestration_plan: Optional[OrchestrationNode] = None

OrchestrationNode.update_forward_refs()

class TeamMemberInfo(BaseModel):
    id: str
    name: str
    description: str
    vibe: str
    skills: List[str]
    is_tl: bool

class TaskRequest(BaseModel):
    message: str
    history: Optional[List[Dict[str, str]]] = []
    team_context: Optional[Dict] = None

class Schedule(BaseModel):
    id: Optional[str] = None
    name: str
    cron: str
    task: str
    target_id: str
    target_type: str
    enabled: bool = True
    last_run_status: Optional[str] = "Never"
    next_run_time: Optional[str] = "Calculating..."
