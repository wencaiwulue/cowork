from fastapi import APIRouter
from typing import Dict

from ..services.settings import get_settings, save_settings

router = APIRouter()


@router.get("/settings")
async def get_settings_api():
    """Get all settings"""
    return get_settings()


@router.post("/settings")
async def save_settings_api(settings: Dict):
    """Save all settings"""
    save_settings(settings)
    return settings
