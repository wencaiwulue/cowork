import os
import json
import uuid
import time
import sqlite3
import traceback
from abc import ABC, abstractmethod
from typing import List, Optional, Dict
from .settings import DATA_DIR, get_settings

MEM0_DIR = os.path.join(DATA_DIR, "mem0_db")
SQLITE_DB = os.path.join(DATA_DIR, "memory.db")
FILE_MEM_DIR = os.path.join(DATA_DIR, "file_memory")

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
        print(f"DEBUG: Mem0Provider.__init__ called with config keys: {list(config.keys())}")
        try:
            from mem0 import Memory
            self.m = Memory.from_config(config)
            print(f"DEBUG: Mem0Provider initialized successfully")
        except Exception as e:
            print(f"ERROR: Failed to initialize Mem0Provider: {str(e)}")
            print(f"DEBUG: Full traceback:\n{traceback.format_exc()}")
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
        self.conn.execute("CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, user_id TEXT, text TEXT, created_at REAL)")
    def add(self, text: str, user_id: str, metadata: Optional[Dict] = None):
        mid = str(uuid.uuid4())
        self.conn.execute("INSERT INTO memories VALUES (?, ?, ?, ?)", (mid, user_id, text, time.time()))
        self.conn.commit()
    def search(self, query: str, user_id: str, limit: int = 5) -> List[Dict]:
        cur = self.conn.execute("SELECT id, text FROM memories WHERE user_id = ? AND text LIKE ? LIMIT ?", (user_id, f"%{query}%", limit))
        return [{"id": r[0], "text": r[1]} for r in cur.fetchall()]
    def get_all(self, user_id: str) -> List[Dict]:
        cur = self.conn.execute("SELECT id, text FROM memories WHERE user_id = ?", (user_id,))
        return [{"id": r[0], "text": r[1]} for r in cur.fetchall()]
    def delete(self, user_id: str, memory_id: str):
        self.conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        self.conn.commit()

class FileMemoryProvider(BaseMemory):
    def add(self, text: str, user_id: str, metadata: Optional[Dict] = None):
        os.makedirs(FILE_MEM_DIR, exist_ok=True)
        path = os.path.join(FILE_MEM_DIR, f"{user_id}.jsonl")
        with open(path, "a") as f:
            f.write(json.dumps({"id": str(uuid.uuid4()), "text": text, "time": time.time()}) + "\n")
    def search(self, query: str, user_id: str, limit: int = 5) -> List[Dict]:
        path = os.path.join(FILE_MEM_DIR, f"{user_id}.jsonl")
        if not os.path.exists(path): return []
        results = []
        with open(path, "r") as f:
            for line in f:
                item = json.loads(line)
                if query.lower() in item["text"].lower():
                    results.append(item)
        return results[:limit]
    def get_all(self, user_id: str) -> List[Dict]:
        path = os.path.join(FILE_MEM_DIR, f"{user_id}.jsonl")
        if not os.path.exists(path): return []
        results = []
        with open(path, "r") as f:
            for line in f:
                results.append(json.loads(line))
        return results
    def delete(self, user_id: str, memory_id: str):
        path = os.path.join(FILE_MEM_DIR, f"{user_id}.jsonl")
        if os.path.exists(path):
            with open(path, "r") as f:
                lines = f.readlines()
            with open(path, "w") as f:
                for line in lines:
                    if json.loads(line)["id"] != memory_id:
                        f.write(line)

def get_memory_provider(agent_id: str) -> BaseMemory:
    print(f"DEBUG: get_memory_provider called for agent {agent_id}")
    settings = get_settings()
    provider_type = settings.get("memory_provider", "mem0")
    llm_config = settings.get("llm", {})
    print(f"DEBUG: Memory provider type: {provider_type}")

    if provider_type == "sqlite":
        print(f"DEBUG: Returning SQLiteMemoryProvider")
        return SQLiteMemoryProvider()
    if provider_type == "file":
        print(f"DEBUG: Returning FileMemoryProvider")
        return FileMemoryProvider()

    mem0_config = {
        "llm": {"provider": "openai", "config": {"model": llm_config.get("model", "gpt-4o"), "api_key": llm_config.get("api_key"), "base_url": llm_config.get("base_url")}},
        "embedder": {"provider": "openai", "config": {"model": "text-embedding-3-small", "api_key": llm_config.get("api_key"), "base_url": llm_config.get("base_url")}},
        "vector_store": {"provider": "qdrant", "config": {"path": MEM0_DIR}},
        "version": "v1.1"
    }
    print(f"DEBUG: Returning Mem0Provider with config")
    return Mem0Provider(mem0_config)
