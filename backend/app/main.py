import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .services.langchain.orchestrator_state import LangChainOrchestrator

# Create FastAPI app
app = FastAPI(title="Agent Platform API")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# LangChain orchestrator instance
langchain_orchestrator: LangChainOrchestrator = None


@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    global langchain_orchestrator

    # Initialize LangChain orchestrator
    langchain_orchestrator = LangChainOrchestrator()
    await langchain_orchestrator.initialize()

    # Set orchestrator in API modules
    from .api import teams, messages, langchain as langchain_api
    teams.set_langchain_orchestrator(langchain_orchestrator)
    messages.set_langchain_orchestrator(langchain_orchestrator)
    langchain_api.set_langchain_orchestrator(langchain_orchestrator)


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    global langchain_orchestrator
    if langchain_orchestrator:
        await langchain_orchestrator.shutdown()
        langchain_orchestrator = None


# Import and register all API routers
from .api import all_routers

for router, prefix, tag in all_routers:
    kwargs = {"tags": [tag]}
    if prefix:
        kwargs["prefix"] = prefix
    app.include_router(router, **kwargs)
