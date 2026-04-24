"""
Long-Term Memory Layer (Mem0-style User Memory)

Manages cross-session user long-term memory.
This is the "user profile" layer - storing extracted facts and preferences
about users that persist across all their conversation sessions.

Key differences from other layers:
- vs Checkpoint: User-level, not execution state
- vs Conversation: Extracted facts, not raw messages
- vs Store: User-scoped with automatic extraction/retrieval

Core capabilities (mem0-style):
1. Automatic Extraction - Identify facts worth remembering from conversations
2. Deduplication/Update - Update existing facts rather than duplicate
3. Semantic Retrieval - Find relevant memories by meaning, not just keywords
4. Cross-Session - Persists across all threads for a user

Usage:
    from app.services.memory import long_term_memory

    # After conversation, extract memories
    facts = long_term_memory.extract_facts(user_id, conversation_text)

    # Before conversation, retrieve relevant memories
    relevant = long_term_memory.search(user_id, query="coding preferences")

    # Inject into context
    system_prompt += f"User facts: {relevant}"
"""

import os
import json
import uuid
import sqlite3
import hashlib
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime
from dataclasses import dataclass, asdict

from ..settings import DATA_DIR


LONG_TERM_DB = os.path.join(DATA_DIR, "long_term_memory.db")


@dataclass
class MemoryFact:
    """Represents a single memory fact about a user."""
    id: str
    user_id: str
    content: str  # The fact itself (e.g., "User is allergic to peanuts")
    category: str  # e.g., "preference", "fact", "skill", "constraint"
    source: Optional[str] = None  # Where this was extracted from
    confidence: float = 1.0  # 0.0 to 1.0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    access_count: int = 0  # How many times retrieved
    last_accessed: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'MemoryFact':
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


class LongTermMemory:
    """
    Mem0-style long-term memory manager.

    Provides:
    1. Storage and retrieval of user facts/preferences
    2. Semantic search for relevant memories
    3. Automatic extraction from conversations (via LLM)
    4. Deduplication and fact updates
    """

    def __init__(self, db_path: str = None):
        self.db_path = db_path or LONG_TERM_DB
        self._ensure_db_dir()
        self._init_db()

    def _ensure_db_dir(self):
        """Ensure the database directory exists."""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

    def _init_db(self):
        """Initialize the database schema."""
        conn = sqlite3.connect(self.db_path)
        try:
            # Main facts table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS facts (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    category TEXT NOT NULL DEFAULT 'fact',
                    source TEXT,
                    confidence REAL NOT NULL DEFAULT 1.0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    access_count INTEGER NOT NULL DEFAULT 0,
                    last_accessed TEXT,
                    content_hash TEXT NOT NULL
                )
            """)

            # Index for user queries
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_facts_user
                ON facts(user_id, category)
            """)

            # Index for content search
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_facts_content
                ON facts(content)
            """)

            # Index for hash lookups (deduplication)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_facts_hash
                ON facts(user_id, content_hash)
            """)

            # Metadata table for system info
            conn.execute("""
                CREATE TABLE IF NOT EXISTS metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)

            conn.commit()
        finally:
            conn.close()

    def _compute_hash(self, content: str) -> str:
        """Compute a hash for content deduplication."""
        return hashlib.md5(content.lower().strip().encode()).hexdigest()

    def add(
        self,
        user_id: str,
        content: str,
        category: str = "fact",
        source: Optional[str] = None,
        confidence: float = 1.0,
    ) -> MemoryFact:
        """
        Add a new fact to long-term memory.

        Args:
            user_id: The user this fact belongs to
            content: The fact content (e.g., "User prefers dark mode")
            category: Category of fact (preference, fact, skill, constraint)
            source: Where this was extracted from
            confidence: Confidence level (0.0 to 1.0)

        Returns:
            The created MemoryFact
        """
        fact_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        content_hash = self._compute_hash(content)

        conn = sqlite3.connect(self.db_path)
        try:
            # Check for existing similar fact (deduplication)
            cursor = conn.execute(
                """
                SELECT id, content, confidence FROM facts
                WHERE user_id = ? AND content_hash = ?
                """,
                (user_id, content_hash)
            )
            existing = cursor.fetchone()

            if existing:
                # Update existing fact with new information
                existing_id, existing_content, existing_conf = existing

                # Merge content or keep the more confident one
                if confidence > existing_conf:
                    conn.execute(
                        """
                        UPDATE facts
                        SET content = ?, source = ?, confidence = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (content, source, confidence, now, existing_id)
                    )
                    conn.commit()

                return self.get_by_id(existing_id)

            # Insert new fact
            conn.execute(
                """
                INSERT INTO facts
                (id, user_id, content, category, source, confidence, created_at, updated_at, content_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (fact_id, user_id, content, category, source, confidence, now, now, content_hash)
            )
            conn.commit()

            return MemoryFact(
                id=fact_id,
                user_id=user_id,
                content=content,
                category=category,
                source=source,
                confidence=confidence,
                created_at=now,
                updated_at=now,
                access_count=0,
                last_accessed=None,
            )
        finally:
            conn.close()

    def get_by_id(self, fact_id: str) -> Optional[MemoryFact]:
        """Get a fact by its ID."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                """
                SELECT id, user_id, content, category, source, confidence,
                       created_at, updated_at, access_count, last_accessed
                FROM facts WHERE id = ?
                """,
                (fact_id,)
            )
            row = cursor.fetchone()
            if not row:
                return None

            return MemoryFact(*row)
        finally:
            conn.close()

    def search(
        self,
        user_id: str,
        query: Optional[str] = None,
        category: Optional[str] = None,
        limit: int = 10,
    ) -> List[MemoryFact]:
        """
        Search for facts about a user.

        Args:
            user_id: The user to search for
            query: Optional text to search in content (substring match)
            category: Optional category filter
            limit: Maximum results to return

        Returns:
            List of matching MemoryFact objects
        """
        conn = sqlite3.connect(self.db_path)
        try:
            # Build query dynamically
            conditions = ["user_id = ?"]
            params = [user_id]

            if category:
                conditions.append("category = ?")
                params.append(category)

            if query:
                conditions.append("content LIKE ?")
                params.append(f"%{query}%")

            where_clause = " AND ".join(conditions)

            # Sort by confidence and recency
            query_sql = f"""
                SELECT id, user_id, content, category, source, confidence,
                       created_at, updated_at, access_count, last_accessed
                FROM facts
                WHERE {where_clause}
                ORDER BY confidence DESC, updated_at DESC
                LIMIT ?
            """
            params.append(limit)

            cursor = conn.execute(query_sql, params)

            results = []
            for row in cursor:
                # Update access count
                fact_id = row[0]
                conn.execute(
                    """
                    UPDATE facts
                    SET access_count = access_count + 1, last_accessed = ?
                    WHERE id = ?
                    """,
                    (datetime.utcnow().isoformat(), fact_id)
                )

                results.append(MemoryFact(*row))

            conn.commit()
            return results
        finally:
            conn.close()

    def get_all_for_user(
        self,
        user_id: str,
        category: Optional[str] = None,
    ) -> List[MemoryFact]:
        """Get all facts for a user, optionally filtered by category."""
        return self.search(user_id, query=None, category=category, limit=10000)

    def update(
        self,
        fact_id: str,
        content: Optional[str] = None,
        confidence: Optional[float] = None,
        source: Optional[str] = None,
    ) -> Optional[MemoryFact]:
        """Update an existing fact."""
        updates = []
        params = []

        if content is not None:
            updates.append("content = ?")
            params.append(content)
            updates.append("content_hash = ?")
            params.append(self._compute_hash(content))

        if confidence is not None:
            updates.append("confidence = ?")
            params.append(confidence)

        if source is not None:
            updates.append("source = ?")
            params.append(source)

        if not updates:
            return self.get_by_id(fact_id)

        updates.append("updated_at = ?")
        params.append(datetime.utcnow().isoformat())
        params.append(fact_id)

        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute(
                f"UPDATE facts SET {', '.join(updates[:-1])} WHERE id = ?",
                params
            )
            conn.commit()
            return self.get_by_id(fact_id)
        finally:
            conn.close()

    def delete(self, fact_id: str) -> bool:
        """Delete a fact by ID."""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute("DELETE FROM facts WHERE id = ?", (fact_id,))
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

    def delete_all_for_user(self, user_id: str, category: Optional[str] = None) -> int:
        """Delete all facts for a user, optionally filtered by category."""
        conn = sqlite3.connect(self.db_path)
        try:
            if category:
                cursor = conn.execute(
                    "DELETE FROM facts WHERE user_id = ? AND category = ?",
                    (user_id, category)
                )
            else:
                cursor = conn.execute(
                    "DELETE FROM facts WHERE user_id = ?",
                    (user_id,)
                )
            conn.commit()
            return cursor.rowcount
        finally:
            conn.close()

    # =========================================================================
    # Mem0-style automatic extraction (simplified version)
    # =========================================================================

    def extract_facts_simple(
        self,
        user_id: str,
        conversation_text: str,
        llm_client = None,
    ) -> List[Dict[str, Any]]:
        """
        Simple rule-based fact extraction (no LLM required).

        For production use, this should be replaced with LLM-based extraction.
        See extract_facts_with_llm() for the proper implementation.
        """
        extracted = []

        # Simple pattern matching for common facts
        patterns = {
            "preference": [
                (r"i (?:like|love|prefer|enjoy) (.+)", "User likes: {}"),
                (r"i (?:don't like|hate|dislike) (.+)", "User dislikes: {}"),
            ],
            "constraint": [
                (r"i (?:can't|cannot|unable to) (.+)", "User cannot: {}"),
                (r"i'm allergic to (.+)", "User is allergic to: {}"),
            ],
            "skill": [
                (r"i (?:know|can|am good at) (.+)", "User knows: {}"),
            ],
        }

        import re

        for category, rules in patterns.items():
            for pattern, template in rules:
                matches = re.finditer(pattern, conversation_text, re.IGNORECASE)
                for match in matches:
                    fact_content = template.format(match.group(1).strip())

                    # Check for duplicates
                    existing = self.search(user_id, query=fact_content, limit=1)
                    if existing:
                        continue

                    fact = self.add(
                        user_id=user_id,
                        content=fact_content,
                        category=category,
                        source="extraction",
                        confidence=0.7,
                    )
                    extracted.append(fact.to_dict())

        return extracted

    def extract_facts_with_llm(
        self,
        user_id: str,
        conversation_text: str,
        llm_client,
    ) -> List[Dict[str, Any]]:
        """
        Extract facts from conversation using LLM.

        This is the proper mem0-style extraction that should be used in production.

        Args:
            user_id: The user to extract facts for
            conversation_text: The conversation text to analyze
            llm_client: An LLM client with chat.completions.create method

        Returns:
            List of extracted and stored MemoryFact dicts
        """
        extraction_prompt = """
Analyze the following conversation and extract important facts about the user that should be remembered for future interactions.

For each fact, provide:
1. The fact content (what was learned)
2. Category: preference, constraint, skill, or personal_info
3. Confidence: 0.0 to 1.0 based on how explicit/clear the information is

Return ONLY a JSON array in this exact format:
[
  {
    "content": "User prefers Python for data analysis",
    "category": "preference",
    "confidence": 0.95
  },
  {
    "content": "User is allergic to peanuts",
    "category": "constraint",
    "confidence": 1.0
  }
]

If no facts should be extracted, return an empty array [].

CONVERSATION TO ANALYZE:
{conversation}
"""

        try:
            response = llm_client.chat.completions.create(
                model="gpt-4o-mini",  # Use smaller model for extraction
                messages=[{
                    "role": "user",
                    "content": extraction_prompt.format(conversation=conversation_text)
                }],
                response_format={"type": "json_object"},
                temperature=0.1,
            )

            result = json.loads(response.choices[0].message.content)
            extracted_facts = result.get("facts", []) if isinstance(result, dict) else result

            stored_facts = []
            for fact_data in extracted_facts:
                content = fact_data.get("content")
                if not content:
                    continue

                # Check for similar existing facts (deduplication)
                existing = self._find_similar_fact(user_id, content)
                if existing:
                    # Update existing if new confidence is higher
                    if fact_data.get("confidence", 0) > existing.confidence:
                        self.update(
                            existing.id,
                            content=content,
                            confidence=fact_data.get("confidence"),
                            source="llm_extraction",
                        )
                    continue

                # Store new fact
                fact = self.add(
                    user_id=user_id,
                    content=content,
                    category=fact_data.get("category", "fact"),
                    source="llm_extraction",
                    confidence=fact_data.get("confidence", 0.8),
                )
                stored_facts.append(fact.to_dict())

            return stored_facts

        except Exception as e:
            print(f"Error extracting facts with LLM: {e}")
            return []

    def _find_similar_fact(self, user_id: str, content: str) -> Optional[MemoryFact]:
        """Find an existing similar fact for deduplication."""
        # Simple approach: check for substring matches
        existing = self.search(user_id, limit=100)

        content_lower = content.lower()
        for fact in existing:
            # Check for high similarity
            if fact.content.lower() in content_lower or content_lower in fact.content.lower():
                return fact

            # Check for word overlap
            existing_words = set(fact.content.lower().split())
            new_words = set(content_lower.split())
            if existing_words and new_words:
                overlap = len(existing_words & new_words) / len(existing_words | new_words)
                if overlap > 0.8:  # 80% word overlap
                    return fact

        return None


# Global long-term memory instance
long_term_memory = LongTermMemory()
