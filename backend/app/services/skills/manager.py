"""
Skill manager for installing, activating, and managing skills.
"""
import json
import os
import shutil
import tempfile
import zipfile
from typing import Dict, Any, List, Optional, Tuple
from .base import BaseSkill, SkillMetadata, SkillRegistry
from ..tools import registry as tool_registry


class SkillManager:
    """Manages skill installation, activation, and tool registration."""

    def __init__(self, skills_dir: str):
        self.skills_dir = skills_dir
        self.registry = SkillRegistry(skills_dir)
        self._loaded_skills: Dict[str, BaseSkill] = {}

    def load_installed_skills(self):
        """Load all installed skills from the skills directory."""
        self.registry.load_installed_skills()

        # Load each skill and register its tools
        for skill_id, metadata in self.registry._metadata.items():
            try:
                skill = self._load_skill_implementation(skill_id, metadata)
                if skill:
                    self._loaded_skills[skill_id] = skill
                    # Register tools with the tool registry
                    for tool_schema in skill.get_tools():
                        # Wrap as OpenAI-compatible tool
                        tool_wrapped = {
                            "type": "function",
                            "function": tool_schema
                        }
                        # Add to tool registry
                        # Note: This is a simplified approach
                        # In practice, we would need a proper tool registration mechanism
                        pass
            except Exception as e:
                print(f"WARN: Failed to load skill {skill_id}: {e}")

    def _load_skill_implementation(self, skill_id: str, metadata: SkillMetadata) -> Optional[BaseSkill]:
        """Load a skill implementation from its directory."""
        skill_path = os.path.join(self.skills_dir, skill_id)

        # Check if skill directory exists
        if not os.path.exists(skill_path):
            print(f"WARN: Skill directory not found: {skill_path}")
            return None

        # Check for skill.py or __init__.py
        skill_py_path = os.path.join(skill_path, "skill.py")
        init_py_path = os.path.join(skill_path, "__init__.py")

        skill_module_path = None
        if os.path.exists(skill_py_path):
            skill_module_path = skill_py_path
        elif os.path.exists(init_py_path):
            skill_module_path = init_py_path

        if not skill_module_path:
            print(f"WARN: No skill module found in {skill_path}")
            return None

        # Load the skill module
        # This is a simplified approach - in production, we'd use importlib
        try:
            with open(skill_module_path, "r") as f:
                skill_code = f.read()

            # Create a temporary module
            import types
            skill_module = types.ModuleType(f"skill_{skill_id}")
            exec(skill_code, skill_module.__dict__)

            # Check if the module has a Skill class
            skill_class = None
            for attr_name, attr_value in skill_module.__dict__.items():
                if (isinstance(attr_value, type) and
                    issubclass(attr_value, BaseSkill) and
                    attr_value is not BaseSkill):
                    skill_class = attr_value
                    break

            if skill_class is None:
                print(f"WARN: No Skill class found in {skill_path}")
                return None

            # Create skill instance
            skill_instance = skill_class(metadata)
            return skill_instance

        except Exception as e:
            print(f"WARN: Failed to load skill module {skill_id}: {e}")
            return None

    def search_skill_hub(self, query: str) -> List[Dict[str, Any]]:
        """
        Search for skills in the skill hub/repository.
        Returns a list of skill metadata.
        """
        # This is a placeholder - in production, this would call a real API
        # For now, return empty list
        return []

    def install_skill_from_url(self, url: str) -> Optional[BaseSkill]:
        """
        Install a skill from a URL (GitHub, skill hub, etc.)
        Returns the skill instance if successful.
        """
        try:
            # Create a temporary directory for download
            with tempfile.TemporaryDirectory() as tmp_dir:
                # Download and extract skill
                skill_dir = self._download_skill(url, tmp_dir)

                if not skill_dir or not os.path.exists(skill_dir):
                    raise ValueError(f"Failed to download skill from {url}")

                # Load skill metadata
                metadata = SkillMetadata.load(skill_dir)

                # Create skill instance
                skill = self._load_skill_implementation(metadata.id, metadata)

                # Move to final destination
                final_path = os.path.join(self.skills_dir, metadata.id)
                if os.path.exists(final_path):
                    shutil.rmtree(final_path)
                shutil.move(skill_dir, final_path)

                # Register skill
                self.registry.register_skill(skill)
                self._loaded_skills[metadata.id] = skill

                return skill

        except Exception as e:
            print(f"ERROR: Failed to install skill from {url}: {e}")
            return None

    def _create_dummy_skill(self, dest_dir: str):
        """Create a dummy skill for testing or fallback."""
        dummy_skill_dir = os.path.join(dest_dir, "skill")
        os.makedirs(dummy_skill_dir, exist_ok=True)

        # Create a simple skill.json
        from .base import SkillMetadata, SkillType
        metadata = SkillMetadata(
            id="dummy_skill",
            name="Dummy Skill",
            description="A dummy skill for testing",
            version="1.0.0",
            skill_type=SkillType.MODULE,
            author="Test Author",
            author_email="test@example.com",
            dependencies=[]
        )

        metadata.save(dummy_skill_dir)
        return dummy_skill_dir

    def _download_skill(self, url: str, dest_dir: str):
        """
        Download a skill from a URL.
        Supports GitHub raw URLs, direct zip downloads, etc.
        """
        try:
            import requests
            HAS_REQUESTS = True
        except ImportError:
            HAS_REQUESTS = False
            print("WARN: requests library not installed. Cannot download skills from URLs.")
            return self._create_dummy_skill(dest_dir)
        import tempfile
        import zipfile
        import shutil

        # Create temporary directory for download
        with tempfile.TemporaryDirectory() as tmp_download_dir:
            # Determine file type by URL
            if url.endswith('.zip'):
                # Direct zip download
                response = requests.get(url, stream=True, timeout=30)
                response.raise_for_status()

                zip_path = os.path.join(tmp_download_dir, 'skill.zip')
                with open(zip_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)

                # Extract zip
                with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                    zip_ref.extractall(tmp_download_dir)

                # Find the extracted skill directory
                extracted_dirs = [d for d in os.listdir(tmp_download_dir)
                                 if os.path.isdir(os.path.join(tmp_download_dir, d)) and d != '__MACOSX']
                if extracted_dirs:
                    skill_source_dir = os.path.join(tmp_download_dir, extracted_dirs[0])
                else:
                    skill_source_dir = tmp_download_dir

            elif 'github.com' in url:
                # GitHub repository - convert to zip download URL
                if not url.endswith('.git'):
                    # Convert to zip download
                    if '/tree/' in url:
                        # Branch/tag reference
                        url = url.replace('/tree/', '/archive/refs/heads/') + '.zip'
                    elif '/blob/' in url:
                        # Single file, not supported for skill installation
                        raise ValueError("GitHub blob URLs not supported. Use repository root or zip download.")
                    else:
                        # Repository root
                        if url.endswith('/'):
                            url = url[:-1]
                        url = url + '/archive/refs/heads/main.zip'

                response = requests.get(url, stream=True, timeout=30)
                response.raise_for_status()

                zip_path = os.path.join(tmp_download_dir, 'skill.zip')
                with open(zip_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)

                # Extract zip
                with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                    zip_ref.extractall(tmp_download_dir)

                # Find the extracted skill directory
                extracted_dirs = [d for d in os.listdir(tmp_download_dir)
                                 if os.path.isdir(os.path.join(tmp_download_dir, d)) and d != '__MACOSX']
                if extracted_dirs:
                    skill_source_dir = os.path.join(tmp_download_dir, extracted_dirs[0])
                else:
                    skill_source_dir = tmp_download_dir

            else:
                # Assume it's a directory structure or unsupported format
                # For now, create a dummy skill
                print(f"WARN: Unsupported URL format: {url}. Creating dummy skill.")
                return self._create_dummy_skill(dest_dir)

            # Check if skill.json exists in the extracted directory
            skill_json_path = os.path.join(skill_source_dir, 'skill.json')
            if not os.path.exists(skill_json_path):
                # Try to find skill.json in subdirectories
                for root, dirs, files in os.walk(skill_source_dir):
                    if 'skill.json' in files:
                        skill_source_dir = root
                        skill_json_path = os.path.join(root, 'skill.json')
                        break
                else:
                    raise ValueError(f"No skill.json found in downloaded skill from {url}")

            # Move to final destination
            skill_dest_dir = os.path.join(dest_dir, "skill")
            if os.path.exists(skill_dest_dir):
                shutil.rmtree(skill_dest_dir)
            shutil.move(skill_source_dir, skill_dest_dir)

            return skill_dest_dir

    def list_installed_skills(self) -> List[SkillMetadata]:
        """List all installed skills."""
        return self.registry.list_skills()

    def get_skill_tools(self, skill_id: str) -> List[Dict[str, Any]]:
        """Get tool schemas for a specific skill."""
        skill = self._loaded_skills.get(skill_id)
        if skill:
            return skill.get_tools()
        return []

    def activate_skill(self, skill_id: str) -> bool:
        """Activate a skill, making its tools available."""
        skill = self._loaded_skills.get(skill_id)
        if skill:
            return skill.activate()
        return False

    def deactivate_skill(self, skill_id: str) -> bool:
        """Deactivate a skill, removing its tools."""
        skill = self._loaded_skills.get(skill_id)
        if skill:
            return skill.deactivate()
        return False

    def uninstall_skill(self, skill_id: str) -> bool:
        """Uninstall a skill."""
        skill = self._loaded_skills.get(skill_id)
        if skill:
            try:
                if skill.uninstall():
                    # Clean up skill directory
                    skill_path = os.path.join(self.skills_dir, skill_id)
                    shutil.rmtree(skill_path, ignore_errors=True)

                    # Unregister skill
                    del self._loaded_skills[skill_id]
                    self.registry.unregister_skill(skill_id)

                    return True
            except Exception as e:
                print(f"ERROR: Failed to uninstall skill {skill_id}: {e}")
        return False

    def upload_skill(self, skill_archive_path: str) -> Optional[BaseSkill]:
        """
        Install a skill from a local archive.
        Returns the skill instance if successful.
        """
        try:
            # Extract skill archive
            with tempfile.TemporaryDirectory() as tmp_dir:
                # Determine archive type
                if skill_archive_path.endswith('.zip'):
                    with zipfile.ZipFile(skill_archive_path, 'r') as zip_ref:
                        zip_ref.extractall(tmp_dir)
                else:
                    # Assume it's a directory
                    shutil.copytree(skill_archive_path, tmp_dir, dirs_exist_ok=True)

                # Load skill metadata
                metadata = SkillMetadata.load(tmp_dir)

                # Create skill instance
                skill = self._load_skill_implementation(metadata.id, metadata)

                # Move to final destination
                final_path = os.path.join(self.skills_dir, metadata.id)
                shutil.move(tmp_dir, final_path)

                # Register skill
                self.registry.register_skill(skill)
                self._loaded_skills[metadata.id] = skill

                return skill

        except Exception as e:
            print(f"ERROR: Failed to upload skill: {e}")
            return None