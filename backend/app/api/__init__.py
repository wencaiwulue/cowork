# API Routes Package
"""
API Module Unified Entry Point

Module Organization:
- agents:     Agent management (create, config, memory, todos, core files)
- teams:      Team management (create, config, task execution)
- skills:     Skill management (local skill install, activate, config)
- skillhub:   Skill marketplace (browse, install remote skills)
- sessions:   Session management (chat session lifecycle)
- schedules:  Scheduled tasks (cron job scheduling)
- messages:   Message management (storage, streaming)
- files:      File management (directory browse, file operations)
- langchain:  LangChain services (tools, RAG, tracing)
- settings:   System settings (global configuration)
"""

from fastapi import APIRouter

# Import all route modules
from .agents import router as agents_router
from .teams import router as teams_router
from .skills import router as skills_router
from .skillhub import router as skillhub_router
from .sessions import router as sessions_router
from .schedules import router as schedules_router
from .messages import router as messages_router
from .files import router as files_router
from .langchain import router as langchain_router
from .settings import router as settings_router

# Router registration configuration:
# (router, prefix, tag_name)
# prefix=None means no URL prefix (routes define their own paths)
all_routers = [
    (settings_router,  None,  "settings"),
    (agents_router,    None,  "agents"),
    (teams_router,     None,  "teams"),
    (skillhub_router,  None,  "skillhub"),
    (skills_router,    None,  "skills"),
    (sessions_router,  None,  "sessions"),
    (schedules_router, None,  "schedules"),
    (messages_router,  None,  "messages"),
    (files_router,     None,  "files"),
    (langchain_router, None,  "langchain"),
]


def register_routers(app):
    """Register all API routers to the FastAPI app

    Args:
        app: FastAPI application instance
    """
    for router, prefix, tag in all_routers:
        kwargs = {"tags": [tag]}
        if prefix:
            kwargs["prefix"] = prefix
        app.include_router(router, **kwargs)
