import os
import json
from typing import Dict

# Use absolute path for DATA_DIR relative to the backend root
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")

# Core directories
AGENTS_DIR = os.path.join(DATA_DIR, "agents")
TEAMS_DIR = os.path.join(DATA_DIR, "teams")
SKILLS_DIR = os.path.join(DATA_DIR, "skills")
SKILLHUB_DIR = os.path.join(DATA_DIR, "skillhub")
SCHEDULES_DIR = os.path.join(DATA_DIR, "schedules")
MESSAGES_DIR = os.path.join(DATA_DIR, "messages")
SESSIONS_DIR = os.path.join(DATA_DIR, "sessions")
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")

# Ensure storage directories exist
for d in [AGENTS_DIR, TEAMS_DIR, SKILLS_DIR, SKILLHUB_DIR, SCHEDULES_DIR, MESSAGES_DIR, SESSIONS_DIR,
          os.path.join(DATA_DIR, "connectors"), 
          os.path.join(DATA_DIR, "channels"), 
          os.path.join(DATA_DIR, "pairings")]:
    os.makedirs(d, exist_ok=True)

DEFAULT_SETTINGS = {
    "skillhub_repo": "https://skillsmp.com", 
    "memory_provider": "mem0",
    "llm": {
        "base_url": "https://api.openai.com/v1",
        "api_key": "",
        "model": "gpt-4o"
    }
}

def get_settings() -> Dict:
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r") as f:
                settings = json.load(f)
                # Merge with defaults to ensure all keys exist
                for key, val in DEFAULT_SETTINGS.items():
                    if key not in settings:
                        settings[key] = val
                return settings
        except:
            return DEFAULT_SETTINGS
    return DEFAULT_SETTINGS

def save_settings(settings: Dict):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=4)
