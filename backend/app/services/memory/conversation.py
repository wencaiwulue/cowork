"""
Conversation Layer (Message History)

Manages conversation threads and message history using SQLite.
This is the "message history" layer - storing the actual conversation content.

Note: This is NOT the same as:
- Checkpoint (execution state for resuming)
- Store (cross-thread shared data)
- Long-term memory (extracted user facts)
"""

import os
import json
import uuid
import sqlite3
from typing import List, Optional, Dict, Any
from datetime import datetime

from ..settings import DATA_DIR


CONVERSATION_DB = os.path.join(DATA_DIR, "conversations.db")


class ConversationMemory:
    """
    Manages conversation threads and message history.
    This is the persistence layer for chat messages.
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
        """Create a new conversation thread for an agent."""
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
        """Add a message to a conversation thread."""
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
        """Get all messages for a conversation thread."""
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
        """Clear all messages for a conversation thread."""
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
        """Get information about a thread."""
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
        """List all conversation threads."""
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
        """Delete a conversation thread and all its messages."""
        conn = sqlite3.connect(self.db_path)
        try:
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
