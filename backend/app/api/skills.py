from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile

from ..services.skills import SkillManager
from ..services.settings import SKILLS_DIR

router = APIRouter()

# Initialize skill manager
skill_manager = SkillManager(SKILLS_DIR)
skill_manager.load_installed_skills()


@router.get("/skills")
async def list_skills():
    """List all installed skills"""
    skills = skill_manager.list_installed_skills()
    return [skill.to_dict() for skill in skills]


@router.get("/skills/{skill_id}")
async def get_skill(skill_id: str):
    """Get skill details"""
    skill = skill_manager.registry.get_metadata(skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    return skill.to_dict()


@router.post("/skills/install")
async def install_skill(skill_id: str, source_url: Optional[str] = None):
    """Install a skill from skill hub or URL"""
    try:
        if source_url:
            # Install from URL
            skill = skill_manager.install_skill_from_url(source_url)
            if not skill:
                raise HTTPException(status_code=400, detail="Failed to install skill from URL")
        else:
            # Install from skill hub (simplified)
            raise HTTPException(status_code=400, detail="Source URL required for installation")

        return {
            "status": "installed",
            "skill_id": skill.metadata.id,
            "skill_name": skill.metadata.name
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/skills/upload")
async def upload_skill(file: UploadFile):
    """Upload and install a skill from a local file"""
    try:
        # Save uploaded file to temporary location
        import tempfile
        with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp_file:
            content = await file.read()
            tmp_file.write(content)
            tmp_path = tmp_file.name

        # Install from the uploaded file
        skill = skill_manager.upload_skill(tmp_path)
        if not skill:
            raise HTTPException(status_code=400, detail="Failed to install skill from upload")

        # Clean up temp file
        os.unlink(tmp_path)

        return {
            "status": "installed",
            "skill_id": skill.metadata.id,
            "skill_name": skill.metadata.name
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/skills/{skill_id}/activate")
async def activate_skill(skill_id: str):
    """Activate a skill to make its tools available"""
    success = skill_manager.activate_skill(skill_id)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to activate skill")
    return {"status": "activated"}


@router.post("/skills/{skill_id}/deactivate")
async def deactivate_skill(skill_id: str):
    """Deactivate a skill"""
    success = skill_manager.deactivate_skill(skill_id)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to deactivate skill")
    return {"status": "deactivated"}


@router.delete("/skills/{skill_id}")
async def uninstall_skill(skill_id: str):
    """Uninstall a skill"""
    success = skill_manager.uninstall_skill(skill_id)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to uninstall skill")
    return {"status": "uninstalled"}


@router.get("/skills/{skill_id}/tools")
async def get_skill_tools(skill_id: str):
    """Get tools provided by a skill"""
    tools = skill_manager.get_skill_tools(skill_id)
    return {"tools": tools}
