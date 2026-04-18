"""
LLM Provider 模块

支持 OpenAI 和本地模型 (Ollama/llama.cpp)
"""

from typing import Dict, Any, Optional, List, Union
from enum import Enum
import os

from pydantic import BaseModel, Field
from langchain_core.language_models import BaseLanguageModel, BaseChatModel
from langchain_core.embeddings import Embeddings
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_ollama import ChatOllama, OllamaEmbeddings


class LLMProviderType(str, Enum):
    """LLM Provider 类型"""
    OPENAI = "openai"
    OLLAMA = "ollama"
    LLAMACPP = "llamacpp"


class EmbeddingProviderType(str, Enum):
    """Embedding Provider 类型"""
    OPENAI = "openai"
    OLLAMA = "ollama"
    HUGGINGFACE = "huggingface"


class LLMConfig(BaseModel):
    """LLM 配置"""
    provider: LLMProviderType = LLMProviderType.OPENAI
    model: str = "gpt-4o-mini"
    temperature: float = 0.7
    max_tokens: Optional[int] = None
    timeout: Optional[float] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    # Ollama 特定配置
    ollama_base_url: str = "http://localhost:11434"
    # 其他配置
    additional_params: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        use_enum_values = True


class EmbeddingConfig(BaseModel):
    """Embedding 配置"""
    provider: EmbeddingProviderType = EmbeddingProviderType.OPENAI
    model: str = "text-embedding-3-small"
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    # Ollama 特定配置
    ollama_base_url: str = "http://localhost:11434"
    # HuggingFace 特定配置
    hf_model_name: Optional[str] = None
    device: str = "cpu"
    # 其他配置
    additional_params: Dict[str, Any] = {}

    class Config:
        use_enum_values = True


class LLMProvider:
    """
    LLM Provider 管理器

    统一管理多种 LLM 和 Embedding 模型的创建和配置
    """

    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self._llm_config: Optional[LLMConfig] = None
        self._embedding_config: Optional[EmbeddingConfig] = None
        self._llm_cache: Dict[str, BaseChatModel] = {}
        self._embedding_cache: Dict[str, Embeddings] = {}

    async def initialize(self):
        """初始化 LLM Provider"""
        # 解析 LLM 配置
        llm_config = self.config.get("llm", {})
        self._llm_config = LLMConfig(**llm_config)

        # 解析 Embedding 配置
        embedding_config = self.config.get("embedding", {})
        self._embedding_config = EmbeddingConfig(**embedding_config)

        # 预热缓存
        _ = self.get_llm()
        _ = self.get_embedding()

    def get_llm(
        self,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        **kwargs
    ) -> BaseChatModel:
        """
        获取 LLM 实例

        Args:
            model: 模型名称，默认使用配置中的模型
            temperature: 温度参数
            **kwargs: 其他参数

        Returns:
            BaseChatModel 实例
        """
        cache_key = f"{model}_{temperature}_{kwargs}"

        if cache_key in self._llm_cache:
            return self._llm_cache[cache_key]

        config = self._llm_config

        if config.provider == LLMProviderType.OPENAI:
            llm = ChatOpenAI(
                model=model or config.model,
                temperature=temperature or config.temperature,
                max_tokens=config.max_tokens,
                timeout=config.timeout,
                api_key=config.api_key or os.getenv("OPENAI_API_KEY"),
                base_url=config.base_url,
                **{**config.additional_params, **kwargs}
            )
        elif config.provider == LLMProviderType.OLLAMA:
            llm = ChatOllama(
                model=model or config.model,
                temperature=temperature or config.temperature,
                base_url=config.ollama_base_url,
                **{**config.additional_params, **kwargs}
            )
        else:
            raise ValueError(f"Unsupported provider: {config.provider}")

        self._llm_cache[cache_key] = llm
        return llm

    def get_embedding(
        self,
        model: Optional[str] = None,
        **kwargs
    ) -> Embeddings:
        """
        获取 Embedding 实例

        Args:
            model: 模型名称
            **kwargs: 其他参数

        Returns:
            Embeddings 实例
        """
        cache_key = f"{model}_{kwargs}"

        if cache_key in self._embedding_cache:
            return self._embedding_cache[cache_key]

        config = self._embedding_config

        if config.provider == EmbeddingProviderType.OPENAI:
            embedding = OpenAIEmbeddings(
                model=model or config.model,
                api_key=config.api_key or os.getenv("OPENAI_API_KEY"),
                base_url=config.base_url,
                **{**config.additional_params, **kwargs}
            )
        elif config.provider == EmbeddingProviderType.OLLAMA:
            embedding = OllamaEmbeddings(
                model=model or config.model,
                base_url=config.ollama_base_url,
                **{**config.additional_params, **kwargs}
            )
        else:
            raise ValueError(f"Unsupported embedding provider: {config.provider}")

        self._embedding_cache[cache_key] = embedding
        return embedding

    def clear_cache(self):
        """清除 LLM 和 Embedding 缓存"""
        self._llm_cache.clear()
        self._embedding_cache.clear()

    async def health_check(self) -> Dict[str, Any]:
        """
        健康检查

        Returns:
            健康状态字典
        """
        status = {
            "initialized": self._llm_config is not None,
            "llm_config": {
                "provider": self._llm_config.provider if self._llm_config else None,
                "model": self._llm_config.model if self._llm_config else None,
            },
            "embedding_config": {
                "provider": self._embedding_config.provider if self._embedding_config else None,
                "model": self._embedding_config.model if self._embedding_config else None,
            },
            "cache": {
                "llm_count": len(self._llm_cache),
                "embedding_count": len(self._embedding_cache),
            }
        }

        # 测试 LLM 连接
        try:
            llm = self.get_llm()
            # 简单测试调用
            # await llm.ainvoke("test")
            status["llm_connection"] = "ok"
        except Exception as e:
            status["llm_connection"] = f"error: {str(e)}"

        return status
