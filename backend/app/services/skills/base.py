"""
Base skill interface and metadata.
"""
import json
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, asdict
from typing import Dict, Any, List, Optional, Type
from datetime import datetime
from enum import Enum


class SkillType(str, Enum):
    """Types of skills."""
    TOOL = "tool"  # Provides tools that can be called by agents
    MODULE = "module"  # Provides reusable modules/utilities
    INTEGRATION = "integration"  # Integrates with external services
    TEMPLATE = "template"  # Provides templates or patterns


@dataclass
class SkillMetadata:
    """Metadata for a skill."""

    # Basic information
    id: str
    name: str
    description: str
    version: str
    skill_type: SkillType

    # Author information
    author: str
    author_email: str = ""
    author_url: str = ""

    # Dependencies
    dependencies: List[str] = None  # List of package dependencies
    python_requires: str = ">=3.8"

    # Compatibility
    min_agent_version: str = "1.0.0"
    tags: List[str] = None

    # Installation info
    installed_at: Optional[str] = None
    installed_by: Optional[str] = None
    source_url: Optional[str] = None  # URL where skill was downloaded from

    # Skill-specific configuration
    config_schema: Optional[Dict[str, Any]] = None  # JSON schema for config

    def __post_init__(self):
        if self.dependencies is None:
            self.dependencies = []
        if self.tags is None:
            self.tags = []

    def to_dict(self) -> Dict[str, Any]:
        """Convert metadata to dictionary."""
        data = asdict(self)
        data["skill_type"] = self.skill_type.value
        return data

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SkillMetadata":
        """Create metadata from dictionary."""
        data = data.copy()
        if "skill_type" in data:
            data["skill_type"] = SkillType(data["skill_type"])
        return cls(**data)

    def save(self, path: str):
        """Save metadata to a JSON file."""
        with open(os.path.join(path, "skill.json"), "w") as f:
            json.dump(self.to_dict(), f, indent=2, default=str)

    @classmethod
    def load(cls, path: str) -> "SkillMetadata":
        """Load metadata from a JSON file."""
        with open(os.path.join(path, "skill.json"), "r") as f:
            data = json.load(f)
        return cls.from_dict(data)


class BaseSkill(ABC):
    """Base class for all skills."""

    def __init__(self, metadata: SkillMetadata, config: Optional[Dict[str, Any]] = None):
        self.metadata = metadata
        self.config = config or {}

    @abstractmethod
    def install(self) -> bool:
        """
        Install the skill. This may include:
        - Installing dependencies
        - Setting up configuration
        - Registering tools
        - Creating necessary directories/files

        Returns True if installation successful.
        """
        pass

    @abstractmethod
    def uninstall(self) -> bool:
        """
        Uninstall the skill. This may include:
        - Removing registered tools
        - Cleaning up resources
        - Uninstalling dependencies (optional)

        Returns True if uninstallation successful.
        """
        pass

    @abstractmethod
    def activate(self) -> bool:
        """
        Activate the skill for use. This may include:
        - Registering tools with the tool registry
        - Initializing connections
        - Loading resources

        Returns True if activation successful.
        """
        pass

    @abstractmethod
    def deactivate(self) -> bool:
        """
        Deactivate the skill. This may include:
        - Unregistering tools
        - Closing connections
        - Releasing resources

        Returns True if deactivation successful.
        """
        pass

    def get_tools(self) -> List[Dict[str, Any]]:
        """
        Get tools provided by this skill.
        Returns a list of tool schemas in OpenAI format.
        """
        return []

    def get_config_schema(self) -> Optional[Dict[str, Any]]:
        """
        Get configuration schema for this skill.
        Returns a JSON schema or None if no configuration needed.
        """
        return None

    def validate_config(self, config: Dict[str, Any]) -> bool:
        """
        Validate configuration for this skill.
        Returns True if configuration is valid.
        """
        return True


class SkillRegistry:
    """Registry for managing installed skills."""

    def __init__(self, skills_dir: str):
        self.skills_dir = skills_dir
        self._skills: Dict[str, BaseSkill] = {}
        self._metadata: Dict[str, SkillMetadata] = {}

    def load_installed_skills(self):
        """Load all installed skills from the skills directory."""
        if not os.path.exists(self.skills_dir):
            os.makedirs(self.skills_dir, exist_ok=True)
            return

        for skill_id in os.listdir(self.skills_dir):
            skill_path = os.path.join(self.skills_dir, skill_id)
            if os.path.isdir(skill_path):
                try:
                    metadata = SkillMetadata.load(skill_path)
                    self._metadata[skill_id] = metadata
                except Exception as e:
                    print(f"WARN: Failed to load skill {skill_id}: {e}")

    def get_skill(self, skill_id: str) -> Optional[BaseSkill]:
        """Get a skill instance by ID."""
        return self._skills.get(skill_id)

    def get_metadata(self, skill_id: str) -> Optional[SkillMetadata]:
        """Get skill metadata by ID."""
        return self._metadata.get(skill_id)

    def list_skills(self) -> List[SkillMetadata]:
        """List all installed skills."""
        return list(self._metadata.values())

    def register_skill(self, skill: BaseSkill):
        """Register a skill instance."""
        self._skills[skill.metadata.id] = skill
        self._metadata[skill.metadata.id] = skill.metadata

    def unregister_skill(self, skill_id: str):
        """Unregister a skill."""
        if skill_id in self._skills:
            del self._skills[skill_id]
        if skill_id in self._metadata:
            del self._metadata[skill_id]

    def get_skill_path(self, skill_id: str) -> str:
        """Get the installation path for a skill."""
        return os.path.join(self.skills_dir, skill_id)