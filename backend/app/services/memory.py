"""
Memory module using SQLite for persistent conversation memory.

This module provides conversation persistence using plain SQLite,
compatible with LangGraph's checkpoint format.
"""

import os
import json
import uuid
import sqlite3
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Tuple, Any
from contextlib import contextmanager
from datetime import datetime

from .settings import DATA_DIR, AGENTS_DIR, get_settings


# Database paths
MEM0_DIR = os.path.join(DATA_DIR, "mem0_db")
SQLITE_DB = os.path.join(DATA_DIR, "memory.db")
FILE_MEM_DIR = os.path.join(DATA_DIR, "file_memory")
CONVERSATION_DB = os.path.join(DATA_DIR, "conversations.db")

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


# =============================================================================
# SQLite Conversation Memory
# =============================================================================

class ConversationMemory:
    """
    Manages conversation threads using plain SQLite.
    Stores conversation history in a simple, queryable format.
    """

    def __init__(self, db_path: str = None):
        self.db_path = db_path or CONVERSATION_DB
        self._ensure_db_dir()
        self._init_db()

    def _ensure_db_dir(self):
        """Ensure the database directory exists."""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

    def _init_db(self):
        """Initialize the database schema."""
        conn = sqlite3.connect(self.db_path)
        try:
            # Create threads table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS threads (
                    thread_id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)

            # Create messages table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    message_id TEXT PRIMARY KEY,
                    thread_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    name TEXT NOT NULL,
                    content TEXT NOT NULL,
                    agent_id TEXT,
                    created_at TEXT NOT NULL,
                    metadata TEXT,
                    FOREIGN KEY (thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
                )
            """)

            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_messages_thread_id
                ON messages(thread_id)
            """)

            conn.commit()
        finally:
            conn.close()

    def create_thread(self, agent_id: str) -> str:
        """
        Create a new conversation thread for an agent.

        Args:
            agent_id: The agent identifier

        Returns:
            The thread ID (UUID string)
        """
        thread_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()

        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute(
                """
                INSERT INTO threads (thread_id, agent_id, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (thread_id, agent_id, now, now)
            )
            conn.commit()
        finally:
            conn.close()

        return thread_id

    def add_message(
        self,
        thread_id: str,
        content: str,
        role: str = "user",
        agent_id: Optional[str] = None,
        agent_name: Optional[str] = None,
        metadata: Optional[Dict] = None,
    ) -> Dict:
        """
        Add a message to a conversation thread.

        Args:
            thread_id: The conversation thread ID
            content: The message content
            role: "user" or "ai"
            agent_id: The agent ID (for AI messages)
            agent_name: The agent name (for AI messages)
            metadata: Additional metadata

        Returns:
            The saved message dict
        """
        message_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        name = agent_name or ("assistant" if role == "ai" else "user")

        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute(
                """
                INSERT INTO messages
                (message_id, thread_id, role, name, content, agent_id, created_at, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (message_id, thread_id, role, name, content, agent_id, now, json.dumps(metadata) if metadata else None)
            )

            # Update thread's updated_at timestamp
            conn.execute(
                "UPDATE threads SET updated_at = ? WHERE thread_id = ?",
                (now, thread_id)
            )

            conn.commit()
        finally:
            conn.close()

        return {
            "id": message_id,
            "role": role,
            "name": name,
            "content": content,
            "agent_id": agent_id,
            "thread_id": thread_id,
            "created_at": now,
            "metadata": metadata or {},
        }

    def get_messages(
        self,
        thread_id: str,
        limit: int = 100,
    ) -> List[Dict]:
        """
        Get all messages for a conversation thread.

        Args:
            thread_id: The conversation thread ID
            limit: Maximum number of messages to return

        Returns:
            List of message dicts
        """
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                """
                SELECT message_id, role, name, content, agent_id, created_at, metadata
                FROM messages
                WHERE thread_id = ?
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (thread_id, limit)
            )

            results = []
            for row in cursor.fetchall():
                metadata = json.loads(row[6]) if row[6] else {}
                results.append({
                    "id": row[0],
                    "role": row[1],
                    "name": row[2],
                    "content": row[3],
                    "agent_id": row[4],
                    "thread_id": thread_id,
                    "created_at": row[5],
                    "metadata": metadata,
                })

            return results
        finally:
            conn.close()

    def clear_messages(self, thread_id: str) -> bool:
        """
        Clear all messages for a conversation thread.

        Args:
            thread_id: The conversation thread ID

        Returns:
            True if successful
        """
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute(
                "DELETE FROM messages WHERE thread_id = ?",
                (thread_id,)
            )
            conn.commit()
            return True
        finally:
            conn.close()

    def get_thread_info(self, thread_id: str) -> Optional[Dict]:
        """
        Get information about a thread.

        Args:
            thread_id: The conversation thread ID

        Returns:
            Thread info dict or None
        """
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                """
                SELECT t.thread_id, t.agent_id, t.created_at, t.updated_at,
                       COUNT(m.message_id) as message_count
                FROM threads t
                LEFT JOIN messages m ON t.thread_id = m.thread_id
                WHERE t.thread_id = ?
                GROUP BY t.thread_id
                """,
                (thread_id,)
            )

            row = cursor.fetchone()
            if row:
                return {
                    "thread_id": row[0],
                    "agent_id": row[1],
                    "created_at": row[2],
                    "updated_at": row[3],
                    "message_count": row[4],
                }
            return None
        finally:
            conn.close()

    def list_threads(self, agent_id: Optional[str] = None) -> List[Dict]:
        """
        List all conversation threads.

        Args:
            agent_id: Optional filter by agent ID

        Returns:
            List of thread info dicts
        """
        conn = sqlite3.connect(self.db_path)
        try:
            query = """
                SELECT t.thread_id, t.agent_id, t.created_at, t.updated_at,
                       COUNT(m.message_id) as message_count
                FROM threads t
                LEFT JOIN messages m ON t.thread_id = m.thread_id
            """
            params = []

            if agent_id:
                query += " WHERE t.agent_id = ?"
                params.append(agent_id)

            query += " GROUP BY t.thread_id ORDER BY t.updated_at DESC"

            cursor = conn.execute(query, params)

            results = []
            for row in cursor.fetchall():
                results.append({
                    "thread_id": row[0],
                    "agent_id": row[1],
                    "created_at": row[2],
                    "updated_at": row[3],
                    "message_count": row[4],
                })

            return results
        finally:
            conn.close()

    def delete_thread(self, thread_id: str) -> bool:
        """
        Delete a conversation thread and all its messages.

        Args:
            thread_id: The conversation thread ID

        Returns:
            True if successful
        """
        conn = sqlite3.connect(self.db_path)
        try:
            # Messages will be deleted due to ON DELETE CASCADE
            conn.execute(
                "DELETE FROM threads WHERE thread_id = ?",
                (thread_id,)
            )
            conn.commit()
            return True
        finally:
            conn.close()


# Global conversation memory instance
conversation_memory = ConversationMemory()


# =============================================================================
# Legacy Memory Providers (kept for backward compatibility)
# =============================================================================

class BaseMemory(ABC):
    @abstractmethod
    def add(self, text: str, user_id: str, metadata: Optional[Dict] = None): pass
    @abstractmethod
    def search(self, query: str, user_id: str, limit: int = 5) -> List[Dict]: pass
    @abstractmethod
    def get_all(self, user_id: str) -> List[Dict]: pass
    @abstractmethod
    def delete(self, user_id: str, memory_id: str): pass


class Mem0Provider(BaseMemory):
    def __init__(self, config: Dict):
        try:
            from mem0 import Memory
            self.m = Memory.from_config(config)
        except Exception as e:
            print(f"ERROR: Failed to initialize Mem0Provider: {e}")
            raise

    def add(self, text: str, user_id: str, metadata: Optional[Dict] = None):
        self.m.add(text, user_id=user_id, metadata=metadata)

    def search(self, query: str, user_id: str, limit: int = 5) -> List[Dict]:
        return self.m.search(query, user_id=user_id, limit=limit)

    def get_all(self, user_id: str) -> List[Dict]:
        return self.m.get_all(user_id=user_id)

    def delete(self, user_id: str, memory_id: str):
        self.m.delete(memory_id)


class SQLiteMemoryProvider(BaseMemory):
    def __init__(self):
        self.conn = sqlite3.connect(SQLITE_DB, check_same_thread=False)
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


def get_memory_provider(agent_id: str) -> BaseMemory:
    settings = get_settings()
    provider_type = settings.get("memory_provider", "mem0")
    llm_config = settings.get("llm", {})

    if provider_type == "sqlite":
        return SQLiteMemoryProvider()
    if provider_type == "file":
        return FileMemoryProvider()

    mem0_config = {
        "llm": {
            "provider": "openai",
            "config": {
                "model": llm_config.get("model", "gpt-4o"),
                "api_key": llm_config.get("api_key"),
                "base_url": llm_config.get("base_url"),
            }
        },
        "embedder": {
            "provider": "openai",
            "config": {
                "model": "text-embedding-3-small",
                "api_key": llm_config.get("api_key"),
                "base_url": llm_config.get("base_url"),
            }
        },
        "vector_store": {"provider": "qdrant", "config": {"path": MEM0_DIR}},
        "version": "v1.1"
    }
    return Mem0Provider(mem0_config)


# =============================================================================
# MEMORY.md helpers
# =============================================================================

_MEMORY_MD_MAX_LINES = 200
_MEMORY_MD_MAX_BYTES = 25_000


def load_memory_md(agent_id: str) -> str:
    """Load MEMORY.md with line/byte truncation."""
    path = os.path.join(AGENTS_DIR, agent_id, "core", "MEMORY.md")
    if not os.path.exists(path):
        return ""
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()

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
