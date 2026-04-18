"""
Skills system for agent platform.
Skills are user-installable extensions that provide additional capabilities.
"""
from .base import BaseSkill, SkillMetadata, SkillRegistry
from .manager import SkillManager

__all__ = ["BaseSkill", "SkillMetadata", "SkillRegistry", "SkillManager"]