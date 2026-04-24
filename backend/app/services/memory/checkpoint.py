"""
Checkpoint Layer (Short-term Execution State)

Manages LangGraph execution state persistence for resuming workflows.
This is the "execution checkpoint" layer - storing the complete state
of a running graph to allow recovery and resumption.

Key differences from other layers:
- vs Conversation: Stores execution state, not just messages
- vs Store: Thread-local, not shared across threads
- vs Long-term: Temporary, bound to a single execution

Usage:
    from app.services.memory import checkpoint_store

    # In LangGraph - automatically used via checkpointer
    graph = workflow.compile(checkpointer=checkpoint_store)

    # Or manual usage
    checkpoint_store.put(config, checkpoint)
    checkpoint = checkpoint_store.get(config)
"""

import os
import json
import sqlite3
from typing import Any, Dict, List, Optional, Tuple, Iterator
from datetime import datetime
from contextlib import contextmanager

from ..settings import DATA_DIR


CHECKPOINT_DB = os.path.join(DATA_DIR, "checkpoints.db")


class SQLiteCheckpointSaver:
    """
    SQLite-based checkpoint saver for LangGraph.

    Stores graph execution state to allow:
    - Resuming interrupted workflows
    - Error recovery
    - Time travel (going back to previous states)

    Note: This is NOT the same as conversation history.
    Checkpoints store the complete execution state including:
    - Channel values (all variable states)
    - Next node to execute
    - Interrupt status
    """

    def __init__(self, db_path: str = None):
        self.db_path = db_path or CHECKPOINT_DB
        self._ensure_db_dir()
        self._init_db()

    def _ensure_db_dir(self):
        """Ensure the database directory exists."""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

    def _init_db(self):
        """Initialize the database schema."""
        conn = sqlite3.connect(self.db_path)
        try:
            # Create checkpoints table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS checkpoints (
                    thread_id TEXT NOT NULL,
                    checkpoint_ns TEXT NOT NULL DEFAULT '',
                    checkpoint_id TEXT NOT NULL,
                    parent_checkpoint_id TEXT,
                    type TEXT NOT NULL,
                    checkpoint BLOB NOT NULL,
                    metadata TEXT,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
                )
            """)

            # Create index for listing checkpoints
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_checkpoints_thread
                ON checkpoints(thread_id, checkpoint_ns, created_at DESC)
            """)

            # Create writes table (for pending operations)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS pending_writes (
                    thread_id TEXT NOT NULL,
                    checkpoint_ns TEXT NOT NULL DEFAULT '',
                    checkpoint_id TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    idx INTEGER NOT NULL,
                    channel TEXT NOT NULL,
                    type TEXT NOT NULL,
                    value BLOB,
                    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
                )
            """)

            conn.commit()
        finally:
            conn.close()

    def get(self, config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Get a checkpoint by config.

        Args:
            config: Configuration with thread_id and optional checkpoint_id

        Returns:
            The checkpoint data or None
        """
        thread_id = config.get("configurable", {}).get("thread_id")
        checkpoint_id = config.get("configurable", {}).get("checkpoint_id")
        checkpoint_ns = config.get("configurable", {}).get("checkpoint_ns", "")

        if not thread_id:
            return None

        conn = sqlite3.connect(self.db_path)
        try:
            if checkpoint_id:
                # Get specific checkpoint
                cursor = conn.execute(
                    """
                    SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
                    FROM checkpoints
                    WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
                    """,
                    (thread_id, checkpoint_ns, checkpoint_id)
                )
            else:
                # Get latest checkpoint
                cursor = conn.execute(
                    """
                    SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
                    FROM checkpoints
                    WHERE thread_id = ? AND checkpoint_ns = ?
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    (thread_id, checkpoint_ns)
                )

            row = cursor.fetchone()
            if not row:
                return None

            return {
                "checkpoint_id": row[0],
                "parent_checkpoint_id": row[1],
                "type": row[2],
                "checkpoint": row[3],  # Blob data
                "metadata": json.loads(row[4]) if row[4] else None,
            }
        finally:
            conn.close()

    def put(self, config: Dict[str, Any], checkpoint: Dict[str, Any]) -> None:
        """
        Save a checkpoint.

        Args:
            config: Configuration with thread_id
            checkpoint: Checkpoint data to save
        """
        thread_id = config.get("configurable", {}).get("thread_id")
        checkpoint_ns = config.get("configurable", {}).get("checkpoint_ns", "")

        if not thread_id:
            raise ValueError("thread_id is required in config")

        checkpoint_id = checkpoint.get("id") or checkpoint.get("checkpoint_id")
        parent_id = checkpoint.get("parent_id") or checkpoint.get("parent_checkpoint_id")
        type_ = checkpoint.get("type", "checkpoint")
        data = checkpoint.get("checkpoint") or checkpoint.get("data")
        metadata = checkpoint.get("metadata")

        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute(
                """
                INSERT OR REPLACE INTO checkpoints
                (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    thread_id,
                    checkpoint_ns,
                    checkpoint_id,
                    parent_id,
                    type_,
                    data if isinstance(data, bytes) else json.dumps(data).encode(),
                    json.dumps(metadata) if metadata else None,
                    datetime.utcnow().isoformat(),
                )
            )
            conn.commit()
        finally:
            conn.close()

    def list(self, config: Dict[str, Any], before: Optional[str] = None, limit: int = 10) -> List[Dict[str, Any]]:
        """
        List checkpoints for a thread.

        Args:
            config: Configuration with thread_id
            before: Optional checkpoint_id to list before
            limit: Maximum number of checkpoints to return

        Returns:
            List of checkpoint metadata
        """
        thread_id = config.get("configurable", {}).get("thread_id")
        checkpoint_ns = config.get("configurable", {}).get("checkpoint_ns", "")

        if not thread_id:
            return []

        conn = sqlite3.connect(self.db_path)
        try:
            if before:
                cursor = conn.execute(
                    """
                    SELECT checkpoint_id, parent_checkpoint_id, type, metadata, created_at
                    FROM checkpoints
                    WHERE thread_id = ? AND checkpoint_ns = ? AND created_at < (
                        SELECT created_at FROM checkpoints WHERE checkpoint_id = ?
                    )
                    ORDER BY created_at DESC
                    LIMIT ?
                    """,
                    (thread_id, checkpoint_ns, before, limit)
                )
            else:
                cursor = conn.execute(
                    """
                    SELECT checkpoint_id, parent_checkpoint_id, type, metadata, created_at
                    FROM checkpoints
                    WHERE thread_id = ? AND checkpoint_ns = ?
                    ORDER BY created_at DESC
                    LIMIT ?
                    """,
                    (thread_id, checkpoint_ns, limit)
                )

            results = []
            for row in cursor.fetchall():
                results.append({
                    "checkpoint_id": row[0],
                    "parent_checkpoint_id": row[1],
                    "type": row[2],
                    "metadata": json.loads(row[3]) if row[3] else None,
                    "created_at": row[4],
                })

            return results
        finally:
            conn.close()


# Global checkpoint store instance
checkpoint_store = SQLiteCheckpointSaver()
