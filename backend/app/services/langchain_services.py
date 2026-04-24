"""
LangChain services for agent communication with persistent memory.
"""

import os

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, AIMessage

from app.models.schemas import AgentInfo, MessageCreate, Message
from app.services.memory import memory_service


class LangChainService:
    """Service for LangChain LLM operations with conversation memory."""

    def __init__(self):
        self.api_key = os.getenv("ANTHROPIC_API_KEY", "")
        self.model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")

    def _get_llm(self, agent_info: AgentInfo | None = None):
        """Get LLM instance with optional agent-specific configuration."""
        system_prompt = None
        if agent_info and agent_info.system_prompt:
            system_prompt = agent_info.system_prompt

        return ChatAnthropic(
            model=self.model,
            anthropic_api_key=self.api_key,
            temperature=0.7,
            max_tokens=4000,
            system=system_prompt,
        )

    async def chat(
        self,
        message: MessageCreate,
        agent_info: AgentInfo,
        thread_id: str
    ) -> Message:
        """
        Send a message to the LLM and get a response, with conversation memory.

        Args:
            message: The user's message
            agent_info: The agent configuration
            thread_id: The conversation thread ID for memory

        Returns:
            The AI's response as a Message
        """
        # Save user message
        user_msg = MessageCreate(content=message.content)
        memory_service.add_message(thread_id, user_msg, None)

        # Get conversation history
        history = memory_service.get_messages(thread_id)

        # Build message list for LLM
        messages = []

        # Add conversation history
        for hist_msg in history[:-1]:  # Exclude the last user message we just added
            if hist_msg.role == "user":
                messages.append(HumanMessage(content=hist_msg.content))
            else:
                messages.append(AIMessage(content=hist_msg.content))

        # Add current user message
        messages.append(HumanMessage(content=message.content))

        # Get LLM response
        llm = self._get_llm(agent_info)
        response = await llm.ainvoke(messages)

        # Save AI response
        ai_message = MessageCreate(content=response.content)
        saved_message = memory_service.add_message(thread_id, ai_message, agent_info)

        return saved_message

    async def clear_conversation(self, thread_id: str) -> bool:
        """Clear conversation memory for a thread."""
        return memory_service.clear_messages(thread_id)


# Global service instance
langchain_service = LangChainService()
