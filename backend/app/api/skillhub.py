from typing import Optional
import httpx
from fastapi import APIRouter, HTTPException

from ..services.settings import get_settings

router = APIRouter()


@router.get("/skillhub")
async def list_skillhub(q: Optional[str] = None):
    """List skills from the skill hub"""
    settings = get_settings()
    repo_url = settings.get("skillhub_repo", "https://skillsmp.com")
    hub_skills = []
    try:
        async with httpx.AsyncClient() as client:
            api_url = repo_url.rstrip('/')
            if "skillsmp.com" in api_url:
                api_url = "https://skillsmp.com/api/skills"
            res = await client.get(api_url, timeout=3.0)
            if res.status_code == 200:
                hub_skills = res.json()
    except:
        pass

    defaults = [
        {"id": "sh-1", "name": "Web Scraper", "description": "Extract content from any website.", "icon": "🌐"},
        {"id": "sh-2", "name": "Python Data Scientist", "description": "Run complex data analysis.", "icon": "🐍"},
        {"id": "sh-3", "name": "Image Generator", "description": "Create visuals from text.", "icon": "🎨"},
        {"id": "sh-4", "name": "Financial Analyst", "description": "Stock market and crypto analysis.", "icon": "📈"},
        {"id": "sh-5", "name": "Code Auditor", "description": "Security and performance reviews.", "icon": "🛡️"}
    ]
    local_ids = {s['id'] for s in hub_skills}
    for s in defaults:
        if s['id'] not in local_ids:
            hub_skills.append(s)
    if q:
        q = q.lower()
        hub_skills = [s for s in hub_skills if q in s['name'].lower() or q in s.get('description', '').lower()]
    return hub_skills
