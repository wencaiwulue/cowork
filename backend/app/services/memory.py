import os
import json
import uuid
import time
import sqlite3
import traceback
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Tuple
from .settings import DATA_DIR, AGENTS_DIR, get_settings

MEM0_DIR = os.path.join(DATA_DIR, "mem0_db")
SQLITE_DB = os.path.join(DATA_DIR, "memory.db")
FILE_MEM_DIR = os.path.join(DATA_DIR, "file_memory")

# Claude Code: MAX_ENTRYPOINT_LINES = 200, MAX_ENTRYPOINT_BYTES = 25_000
_MEMORY_MD_MAX_LINES = 200
_MEMORY_MD_MAX_BYTES = 25_000

# Context window sizes per model (approx tokens). Used by maybe_compact_messages.
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
# Verbatim turns kept after compaction (mirrors Claude Code's approach)
_KEEP_RECENT_TURNS = 6


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
        # migrate: add scope column if missing
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


# ─── MEMORY.md helpers (Claude Code pattern) ─────────────────────────────────

def load_memory_md(agent_id: str) -> str:
    """Load MEMORY.md with line/byte truncation (mirrors Claude Code MAX_ENTRYPOINT_*)."""
    path = os.path.join(AGENTS_DIR, agent_id, "core", "MEMORY.md")
    if not os.path.exists(path):
        return ""
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()

    # Byte cap first
    if len(raw.encode("utf-8")) > _MEMORY_MD_MAX_BYTES:
        raw = raw.encode("utf-8")[:_MEMORY_MD_MAX_BYTES].decode("utf-8", errors="ignore")
        raw += "\n\n[...MEMORY.md truncated at 25 KB...]"

    # Line cap
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
    Used by find_relevant_memories() to build the selector context.
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
    """
    Group episodic memories by scope (user / project / session).
    Mirrors Claude Code's AgentMemoryScope.
    """
    mem = get_memory_provider(agent_id)
    all_mems = mem.get_all(agent_id)
    scoped: Dict[str, List[Dict]] = {"user": [], "project": [], "session": []}
    for m in all_mems:
        scope = (m.get("metadata") or {}).get("scope", "user")
        bucket = scoped.get(scope, scoped["user"])
        bucket.append(m)
    return scoped


# ─── Context compaction (Claude Code: maybe_compact_messages) ─────────────────

def _estimate_tokens(messages: List[Dict]) -> int:
    """Rough token estimate: 1 token ≈ 4 chars."""
    total = sum(len(str(m.get("content", ""))) for m in messages)
    return total // 4


def _get_context_limit(model: str) -> int:
    for key, limit in CONTEXT_LIMITS.items():
        if key in model.lower():
            return limit
    return 32_000  # conservative fallback


async def maybe_compact_messages(
    messages: List[Dict],
    model: str,
    client,
    fast_model: Optional[str] = None,
) -> List[Dict]:
    """
    If conversation exceeds 75% of model context, summarise old turns and keep
    the last _KEEP_RECENT_TURNS verbatim. Returns the (possibly compacted) list.
    """
    limit = _get_context_limit(model)
    used = _estimate_tokens(messages)
    if used < limit * _COMPACTION_THRESHOLD:
        return messages

    print(f"DEBUG: Compaction triggered — {used} estimated tokens, limit {limit}")

    system_msgs = [m for m in messages if m["role"] == "system"]
    convo_msgs = [m for m in messages if m["role"] != "system"]

    # Keep recent turns verbatim
    if len(convo_msgs) <= _KEEP_RECENT_TURNS * 2:
        return messages  # nothing to compact

    old_msgs = convo_msgs[:-(_KEEP_RECENT_TURNS * 2)]
    recent_msgs = convo_msgs[-(_KEEP_RECENT_TURNS * 2):]

    summary_prompt = (
        "Summarise the following conversation in concise bullet points, "
        "preserving key facts, decisions, and context that would be needed "
        "to continue the conversation. Be thorough but brief.\n\n"
        + "\n".join(f"{m['role'].upper()}: {m['content']}" for m in old_msgs)
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
