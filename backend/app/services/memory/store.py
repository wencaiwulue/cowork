"""
Store Layer (Cross-Thread Shared Storage)

Manages namespace-based key-value storage that can be shared across threads.
This is the "shared state" layer - storing facts, preferences, and context
that should persist across different conversation threads.

Key differences from other layers:
- vs Checkpoint: Cross-thread shared, not execution state
- vs Conversation: Structured data, not message history
- vs Long-term: Scoped to sessions/teams, not user-level

Usage:
    from app.services.memory import shared_store

    # Store shared data
    shared_store.put("team_prefs", "coding_style", {"language": "python"})

    # Retrieve across threads
    style = shared_store.get("team_prefs", "coding_style")
"""

import os
import json
import sqlite3
from typing import Any, Dict, List, Optional, Iterator, Tuple
from datetime import datetime

from ..settings import DATA_DIR


STORE_DB = os.path.join(DATA_DIR, "shared_store.db")


class SharedStore:
    """
    Namespace-based key-value store for cross-thread shared data.

    Similar to LangGraph's BaseStore but implemented with SQLite
    for persistence.
    """

    def __init__(self, db_path: str = None):
        self.db_path = db_path or STORE_DB
        self._ensure_db_dir()
        self._init_db()

    def _ensure_db_dir(self):
        """Ensure the database directory exists."""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

    def _init_db(self):
        """Initialize the database schema."""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS store_items (
                    namespace TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (namespace, key)
                )
            """)

            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_store_namespace
                ON store_items(namespace)
            """)

            conn.commit()
        finally:
            conn.close()

    def get(self, namespace: str, key: str) -> Optional[Any]:
        """
        Get a value from the store.

        Args:
            namespace: Namespace for the key
            key: Key within the namespace

        Returns:
            The stored value or None
        """
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                "SELECT value FROM store_items WHERE namespace = ? AND key = ?",
                (namespace, key)
            )
            row = cursor.fetchone()
            if row:
                return json.loads(row[0])
            return None
        finally:
            conn.close()

    def put(self, namespace: str, key: str, value: Any) -> None:
        """
        Store a value in the store.

        Args:
            namespace: Namespace for the key
            key: Key within the namespace
            value: Value to store (must be JSON serializable)
        """
        now = datetime.utcnow().isoformat()
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute(
                """
                INSERT INTO store_items (namespace, key, value, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(namespace, key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                """,
                (namespace, key, json.dumps(value), now, now)
            )
            conn.commit()
        finally:
            conn.close()

    def delete(self, namespace: str, key: str) -> bool:
        """
        Delete a value from the store.

        Args:
            namespace: Namespace for the key
            key: Key within the namespace

        Returns:
            True if a value was deleted
        """
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                "DELETE FROM store_items WHERE namespace = ? AND key = ?",
                (namespace, key)
            )
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

    def search(
        self,
        namespace_prefix: str,
        filter_fn: Optional[callable] = None
    ) -> Iterator[Tuple[str, Any]]:
        """
        Search for keys in a namespace.

        Args:
            namespace_prefix: Namespace prefix to search
            filter_fn: Optional filter function(value, key) -> bool

        Yields:
            Tuples of (key, value)
        """
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                "SELECT key, value FROM store_items WHERE namespace = ?",
                (namespace_prefix,)
            )

            for row in cursor:
                key, value_json = row
                value = json.loads(value_json)
                if filter_fn is None or filter_fn(value, key):
                    yield key, value
        finally:
            conn.close()

    def list_namespaces(self) -> List[str]:
        """List all namespaces in the store."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                "SELECT DISTINCT namespace FROM store_items ORDER BY namespace"
            )
            return [row[0] for row in cursor]
        finally:
            conn.close()


# Global shared store instance
shared_store = SharedStore()
