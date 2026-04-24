"""
Memory module with three-layer architecture.

This module provides three distinct persistence layers for different use cases:

┌─────────────────────────────────────────────────────────────────────┐
│ Layer 1: Checkpoint (Short-term Execution State)                    │
│ - Purpose: Save/restore LangGraph execution state                   │
│ - Lifetime: Single thread execution                                 │
│ - Use case: Resume interrupted workflows, error recovery            │
│ - Implementation: SQLiteCheckpointSaver                             │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 2: Store (Cross-Thread Shared Storage)                        │
│ - Purpose: Share data across different conversation threads         │
│ - Lifetime: Session/team scope                                       │
│ - Use case: Shared preferences, team settings, session context    │
│ - Implementation: SharedStore                                       │
├─────────────────────────────────────────────────────────────────────┤
│ Layer 3: Long-term Memory (Mem0-style User Memory)                  │
│ - Purpose: Extract and recall user facts across all sessions      │
│ - Lifetime: Permanent, user-scoped                                   │
│ - Use case: User preferences, personal info, accumulated knowledge  │
│ - Implementation: LongTermMemory                                    │
└─────────────────────────────────────────────────────────────────────┘

Quick Start:
    # 1. Message history (conversation layer)
    from app.services.memory import conversation_memory
    thread_id = conversation_memory.create_thread(agent_id)
    conversation_memory.add_message(thread_id, "Hello!")
    messages = conversation_memory.get_messages(thread_id)

    # 2. Execution checkpoint (for LangGraph)
    from app.services.memory import checkpoint_store
    # Used automatically by LangGraph when compiling workflows
    graph = workflow.compile(checkpointer=checkpoint_store)

    # 3. Cross-thread shared storage
    from app.services.memory import shared_store
    shared_store.put("team_prefs", "coding_style", {"language": "python"})
    style = shared_store.get("team_prefs", "coding_style")

    # 4. Long-term user memory (Mem0-style)
    from app.services.memory import long_term_memory
    # Extract facts from conversation
    facts = long_term_memory.extract_facts_simple(user_id, conversation_text)
    # Or with LLM for better extraction
    facts = long_term_memory.extract_facts_with_llm(user_id, text, llm_client)
    # Retrieve relevant memories
    relevant = long_term_memory.search(user_id, "coding preferences")

For more details, see the documentation in each submodule:
- conversation.py: Message history management
- checkpoint.py: LangGraph execution state
- store.py: Cross-thread shared storage
- long_term.py: Mem0-style user memory
"""

# Import all layer implementations
from .conversation import ConversationMemory, conversation_memory
from .checkpoint import SQLiteCheckpointSaver, checkpoint_store
from .store import SharedStore, shared_store
from .long_term import LongTermMemory, long_term_memory, MemoryFact

# =============================================================================
# Backward Compatibility: Legacy memory functions from old memory.py
# These functions are kept for compatibility with existing code
# =============================================================================

import os
import json
import time
import uuid
import sqlite3
from typing import List, Dict, Optional, Tuple, Any
from ..settings import AGENTS_DIR, DATA_DIR, get_settings

# Legacy memory directory
FILE_MEM_DIR = os.path.join(DATA_DIR, "file_memory")


# Context window sizes per model (approx tokens)
CONTEXT_LIMITS: Dict[str, int] = {
    "gpt-4o": 128_000,
    "gpt-4o-mini": 128_000,
    "gpt-4-turbo": 128_000,
    "gpt-4": 8_192,
    "gpt-3.5-turbo": 16_385,
    "claude-3-5-sonnet": 200_000,
    "claude-3-5-haiku": 200_000,
    "claude-3-opus": 200_000,
    "claude-sonnet": 200_000,
    "claude-haiku": 200_000,
    "deepseek-chat": 64_000,
    "deepseek-reasoner": 64_000,
    "o1": 128_000,
    "o3-mini": 128_000,
}

_COMPACTION_THRESHOLD = 0.75
_KEEP_RECENT_TURNS = 6


def get_memory_provider(agent_id: str):
    """Get the appropriate memory provider for an agent."""
    settings = get_settings()
    provider_type = settings.get("memory_provider", "sqlite")

    if provider_type == "sqlite":
        return SQLiteMemoryProvider()
    if provider_type == "file":
        return FileMemoryProvider()

    # Default to SQLite
    return SQLiteMemoryProvider()


# Legacy memory providers for backward compatibility
class BaseMemory:
    """Base class for memory providers."""

    def add(self, text: str, user_id: str, metadata: Optional[Dict] = None):
        raise NotImplementedError

    def search(self, query: str, user_id: str, limit: int = 5) -> List[Dict]:
        raise NotImplementedError

    def get_all(self, user_id: str) -> List[Dict]:
        raise NotImplementedError

    def delete(self, user_id: str, memory_id: str):
        raise NotImplementedError


class SQLiteMemoryProvider(BaseMemory):
    """SQLite-based memory provider."""

    def __init__(self):
        self.conn = sqlite3.connect(
            os.path.join(DATA_DIR, "memory.db"),
            check_same_thread=False
        )
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS memories "
            "(id TEXT PRIMARY KEY, user_id TEXT, text TEXT, created_at REAL, scope TEXT DEFAULT 'user')"
        )
        try:
            self.conn.execute("ALTER TABLE memories ADD COLUMN scope TEXT DEFAULT 'user'")
            self.conn.commit()
        except sqlite3.OperationalError:
            pass

    def add(self, text: str, user_id: str, metadata: Optional[Dict] = None):
        mid = str(uuid.uuid4())
        scope = (metadata or {}).get("scope", "user")
        self.conn.execute(
            "INSERT INTO memories VALUES (?, ?, ?, ?, ?)",
            (mid, user_id, text, time.time(), scope)
        )
        self.conn.commit()

    def search(self, query: str, user_id: str, limit: int = 5) -> List[Dict]:
        cur = self.conn.execute(
            "SELECT id, text, created_at, scope FROM memories WHERE user_id = ? AND text LIKE ? LIMIT ?",
            (user_id, f"%{query}%", limit)
        )
        return [{"id": r[0], "text": r[1], "created_at": r[2], "metadata": {"scope": r[3]}} for r in cur.fetchall()]

    def get_all(self, user_id: str) -> List[Dict]:
        cur = self.conn.execute(
            "SELECT id, text, created_at, scope FROM memories WHERE user_id = ?",
            (user_id,)
        )
        return [{"id": r[0], "text": r[1], "created_at": r[2], "metadata": {"scope": r[3]}} for r in cur.fetchall()]

    def delete(self, user_id: str, memory_id: str):
        self.conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        self.conn.commit()


class FileMemoryProvider(BaseMemory):
    """File-based memory provider."""

    def _path(self, user_id: str) -> str:
        os.makedirs(FILE_MEM_DIR, exist_ok=True)
        return os.path.join(FILE_MEM_DIR, f"{user_id}.jsonl")

    def add(self, text: str, user_id: str, metadata: Optional[Dict] = None):
        scope = (metadata or {}).get("scope", "user")
        with open(self._path(user_id), "a") as f:
            f.write(json.dumps({"id": str(uuid.uuid4()), "text": text, "created_at": time.time(), "metadata": {"scope": scope}}) + "\n")

    def search(self, query: str, user_id: str, limit: int = 5) -> List[Dict]:
        path = self._path(user_id)
        if not os.path.exists(path):
            return []
        results = []
        with open(path, "r") as f:
            for line in f:
                item = json.loads(line)
                if query.lower() in item["text"].lower():
                    results.append(item)
        return results[:limit]

    def get_all(self, user_id: str) -> List[Dict]:
        path = self._path(user_id)
        if not os.path.exists(path):
            return []
        with open(path, "r") as f:
            return [json.loads(line) for line in f]

    def delete(self, user_id: str, memory_id: str):
        path = self._path(user_id)
        if not os.path.exists(path):
            return
        with open(path, "r") as f:
            lines = f.readlines()
        with open(path, "w") as f:
            for line in lines:
                if json.loads(line).get("id") != memory_id:
                    f.write(line)


def load_memory_md(agent_id: str) -> str:
    """Load MEMORY.md with line/byte truncation."""
    path = os.path.join(AGENTS_DIR, agent_id, "core", "MEMORY.md")
    if not os.path.exists(path):
        return ""
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()

    _MEMORY_MD_MAX_LINES = 200
    _MEMORY_MD_MAX_BYTES = 25_000

    if len(raw.encode("utf-8")) > _MEMORY_MD_MAX_BYTES:
        raw = raw.encode("utf-8")[:_MEMORY_MD_MAX_BYTES].decode("utf-8", errors="ignore")
        raw += "\n\n[...MEMORY.md truncated at 25 KB...]"

    lines = raw.split("\n")
    if len(lines) > _MEMORY_MD_MAX_LINES:
        lines = lines[:_MEMORY_MD_MAX_LINES]
        lines.append(f"\n[...MEMORY.md truncated at {_MEMORY_MD_MAX_LINES} lines...]")
        raw = "\n".join(lines)

    return raw


def get_core_file(agent_id: str, filename: str) -> str:
    """Read any file under agent core/ directory."""
    path = os.path.join(AGENTS_DIR, agent_id, "core", filename)
    if not os.path.exists(path):
        return ""
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def list_core_files_with_headers(agent_id: str) -> List[Tuple[str, str]]:
    """
    Return [(filename, first_line_header), ...] for all .md files in core/.
    """
    core_dir = os.path.join(AGENTS_DIR, agent_id, "core")
    results = []
    if not os.path.exists(core_dir):
        return results
    for fname in sorted(os.listdir(core_dir)):
        if not fname.endswith(".md"):
            continue
        fpath = os.path.join(core_dir, fname)
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                header = f.readline().strip()
        except Exception:
            header = fname
        results.append((fname, header))
    return results


def get_agent_memory_by_scope(agent_id: str) -> Dict[str, List[Dict]]:
    """Group episodic memories by scope (user / project / session)."""
    mem = get_memory_provider(agent_id)
    all_mems = mem.get_all(agent_id)
    scoped: Dict[str, List[Dict]] = {"user": [], "project": [], "session": []}
    for m in all_mems:
        scope = (m.get("metadata") or {}).get("scope", "user")
        bucket = scoped.get(scope, scoped["user"])
        bucket.append(m)
    return scoped


# =============================================================================
# Context compaction
# =============================================================================

def _estimate_tokens(messages: List[Dict]) -> int:
    """Rough token estimate: 1 token ~ 4 chars."""
    total = sum(len(str(m.get("content", ""))) for m in messages)
    return total // 4


def _get_context_limit(model: str) -> int:
    for key, limit in CONTEXT_LIMITS.items():
        if key in model.lower():
            return limit
    return 32_000


async def maybe_compact_messages(
    messages: List[Dict],
    model: str,
    client,
    fast_model: Optional[str] = None,
) -> List[Dict]:
    """
    If conversation exceeds 75% of model context, summarise old turns and keep
    the last _KEEP_RECENT_TURNS verbatim.
    """
    limit = _get_context_limit(model)
    used = _estimate_tokens(messages)
    if used < limit * _COMPACTION_THRESHOLD:
        return messages

    print(f"DEBUG: Compaction triggered — {used} estimated tokens, limit {limit}")

    system_msgs = [m for m in messages if m.get("role") == "system"]
    convo_msgs = [m for m in messages if m.get("role") != "system"]

    if len(convo_msgs) <= _KEEP_RECENT_TURNS * 2:
        return messages

    old_msgs = convo_msgs[:-(_KEEP_RECENT_TURNS * 2)]
    recent_msgs = convo_msgs[-(_KEEP_RECENT_TURNS * 2):]

    summary_prompt = (
        "Summarise the following conversation in concise bullet points, "
        "preserving key facts, decisions, and context that would be needed "
        "to continue the conversation. Be thorough but brief.\n\n"
        + "\n".join(f"{m.get('role', 'unknown').upper()}: {m.get('content', '')}" for m in old_msgs)
    )

    compact_model = fast_model or model
    try:
        resp = await client.chat.completions.create(
            model=compact_model,
            messages=[{"role": "user", "content": summary_prompt}],
            max_tokens=1024,
        )
        summary = resp.choices[0].message.content or ""
    except Exception as e:
        print(f"WARN: Compaction LLM call failed: {e}")
        return messages

    summary_system = {
        "role": "system",
        "content": f"[CONVERSATION SUMMARY — earlier turns compacted]\n{summary}"
    }

    compacted = system_msgs + [summary_system] + recent_msgs
    print(f"DEBUG: Compaction complete — {len(messages)} → {len(compacted)} messages")
    return compacted


# Export all public symbols
__all__ = [
    # Layer 1: Conversation (Message History)
    "ConversationMemory",
    "conversation_memory",
    # Layer 2: Checkpoint (Execution State)
    "SQLiteCheckpointSaver",
    "checkpoint_store",
    # Layer 3: Store (Cross-Thread Shared)
    "SharedStore",
    "shared_store",
    # Layer 4: Long-term Memory (Mem0-style)
    "LongTermMemory",
    "long_term_memory",
    "MemoryFact",
    # Legacy compatibility functions
    "get_memory_provider",
    "load_memory_md",
    "get_core_file",
    "list_core_files_with_headers",
    "maybe_compact_messages",
    "BaseMemory",
    "SQLiteMemoryProvider",
    "FileMemoryProvider",
]
