"""
RAG (Retrieval-Augmented Generation) 模块

提供完整的 RAG 能力，包括文档加载、切分、Embedding、检索和生成
"""

from typing import Dict, Any, Optional, List, AsyncIterator, Union
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field
import os
import hashlib

from langchain_core.runnables import Runnable, RunnableConfig
from langchain_core.documents import Document
from langchain_core.vectorstores import VectorStore, VectorStoreRetriever
from langchain_core.embeddings import Embeddings

# Document Loaders
from langchain_community.document_loaders import (
    TextLoader,
    PyPDFLoader,
    UnstructuredWordDocumentLoader,
    UnstructuredMarkdownLoader,
    CSVLoader,
    JSONLoader,
)

# Text Splitters
from langchain_text_splitters import (
    RecursiveCharacterTextSplitter,
    CharacterTextSplitter,
    TokenTextSplitter,
)


class DocumentType(str, Enum):
    """文档类型"""
    PDF = "pdf"
    WORD = "docx"
    MARKDOWN = "md"
    TEXT = "txt"
    CSV = "csv"
    JSON = "json"
    HTML = "html"
    UNKNOWN = "unknown"


class ChunkingStrategy(str, Enum):
    """文本切分策略"""
    RECURSIVE = "recursive"
    CHARACTER = "character"
    TOKEN = "token"
    SEMANTIC = "semantic"


class RetrievalStrategy(str, Enum):
    """检索策略"""
    SIMILARITY = "similarity"
    MMR = "mmr"  # Maximal Marginal Relevance
    SIMILARITY_SCORE_THRESHOLD = "similarity_score_threshold"


class DocumentLoaderConfig(BaseModel):
    """文档加载器配置"""
    type: str = "auto"  # auto, text, pdf, word, markdown, csv, json
    encoding: str = "utf-8"
    additional_params: Dict[str, Any] = Field(default_factory=dict)


class TextSplitterConfig(BaseModel):
    """文本切分器配置"""
    strategy: ChunkingStrategy = ChunkingStrategy.RECURSIVE
    chunk_size: int = 1000
    chunk_overlap: int = 200
    separator: str = "\n"
    additional_params: Dict[str, Any] = Field(default_factory=dict)


class EmbeddingConfig(BaseModel):
    """Embedding 配置"""
    provider: str = "openai"  # openai, ollama, huggingface
    model: str = "text-embedding-3-small"
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    # Ollama 配置
    ollama_base_url: str = "http://localhost:11434"
    # HuggingFace 配置
    device: str = "cpu"
    normalize_embeddings: bool = True


class VectorStoreConfig(BaseModel):
    """Vector Store 配置"""
    type: str = "qdrant"  # qdrant, chroma, lancedb, faiss
    # Qdrant 配置
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: Optional[str] = None
    collection_name: str = "documents"
    # 通用配置
    distance_metric: str = "cosine"  # cosine, euclidean, dot


class RetrieverConfig(BaseModel):
    """检索器配置"""
    strategy: RetrievalStrategy = RetrievalStrategy.SIMILARITY
    top_k: int = 5
    # MMR 特定配置
    fetch_k: int = 20
    lambda_mult: float = 0.5
    # 相似度阈值
    score_threshold: float = 0.7


class RAGChainConfig(BaseModel):
    """RAG Chain 配置"""
    chain_type: str = "stuff"  # stuff, map_reduce, refine, map_rerank
    # Prompt 配置
    system_prompt: Optional[str] = None
    context_prompt: Optional[str] = None
    # 其他配置
    return_source_documents: bool = True
    verbose: bool = False


class RAGConfiguration(BaseModel):
    """
    RAG 完整配置
    """
    id: str
    name: str
    description: Optional[str] = None

    # 各模块配置
    document_loader: DocumentLoaderConfig = Field(default_factory=DocumentLoaderConfig)
    text_splitter: TextSplitterConfig = Field(default_factory=TextSplitterConfig)
    embedding: EmbeddingConfig = Field(default_factory=EmbeddingConfig)
    vectorstore: VectorStoreConfig = Field(default_factory=VectorStoreConfig)
    retriever: RetrieverConfig = Field(default_factory=RetrieverConfig)
    rag_chain: RAGChainConfig = Field(default_factory=RAGChainConfig)

    # 状态
    enabled: bool = True
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)


class DocumentInfo(BaseModel):
    """文档信息"""
    id: str
    config_id: str
    filename: str
    file_path: Optional[str] = None
    file_type: DocumentType = DocumentType.UNKNOWN
    file_size: int = 0
    chunk_count: int = 0
    status: str = "pending"  # pending, processing, completed, error
    error_message: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None


class RAGManager:
    """
    RAG 管理器

    提供完整的 RAG 流程管理，包括文档处理、索引和检索
    """

    def __init__(self, llm_provider, embedding_provider=None):
        self.llm_provider = llm_provider
        self.embedding_provider = embedding_provider or llm_provider
        self._configs: Dict[str, RAGConfiguration] = {}
        self._documents: Dict[str, DocumentInfo] = {}
        self._vectorstores: Dict[str, VectorStore] = {}
        self._retrievers: Dict[str, VectorStoreRetriever] = {}

    async def initialize(self):
        """初始化 RAG 管理器"""
        pass

    # ============= Configuration Methods =============

    def create_config(self, config: RAGConfiguration) -> RAGConfiguration:
        """创建 RAG 配置"""
        self._configs[config.id] = config
        return config

    def get_config(self, config_id: str) -> Optional[RAGConfiguration]:
        """获取 RAG 配置"""
        return self._configs.get(config_id)

    def update_config(self, config_id: str, updates: Dict[str, Any]) -> Optional[RAGConfiguration]:
        """更新 RAG 配置"""
        config = self._configs.get(config_id)
        if not config:
            return None

        for key, value in updates.items():
            if hasattr(config, key):
                setattr(config, key, value)

        config.updated_at = datetime.now()
        return config

    def delete_config(self, config_id: str) -> bool:
        """删除 RAG 配置"""
        if config_id in self._configs:
            del self._configs[config_id]
            return True
        return False

    def list_configs(self) -> List[Dict[str, Any]]:
        """列出所有 RAG 配置"""
        return [
            {
                "id": config.id,
                "name": config.name,
                "description": config.description,
                "enabled": config.enabled,
                "created_at": config.created_at.isoformat(),
                "updated_at": config.updated_at.isoformat(),
            }
            for config in self._configs.values()
        ]

    # ============= Document Processing Methods =============

    def _get_document_type(self, filename: str) -> DocumentType:
        """根据文件名获取文档类型"""
        ext = os.path.splitext(filename)[1].lower()
        type_map = {
            ".pdf": DocumentType.PDF,
            ".docx": DocumentType.WORD,
            ".doc": DocumentType.WORD,
            ".md": DocumentType.MARKDOWN,
            ".txt": DocumentType.TEXT,
            ".csv": DocumentType.CSV,
            ".json": DocumentType.JSON,
            ".html": DocumentType.HTML,
            ".htm": DocumentType.HTML,
        }
        return type_map.get(ext, DocumentType.UNKNOWN)

    def _get_loader_for_document(self, file_path: str, config: DocumentLoaderConfig):
        """获取文档加载器"""
        doc_type = self._get_document_type(file_path)

        loader_map = {
            DocumentType.PDF: PyPDFLoader,
            DocumentType.WORD: UnstructuredWordDocumentLoader,
            DocumentType.MARKDOWN: UnstructuredMarkdownLoader,
            DocumentType.TEXT: TextLoader,
            DocumentType.CSV: CSVLoader,
            DocumentType.JSON: JSONLoader,
        }

        loader_class = loader_map.get(doc_type, TextLoader)

        loader_params = {
            "file_path": file_path,
            **config.additional_params
        }

        if doc_type == DocumentType.TEXT:
            loader_params["encoding"] = config.encoding

        return loader_class(**loader_params)

    def _get_text_splitter(self, config: TextSplitterConfig):
        """获取文本切分器"""
        if config.strategy == ChunkingStrategy.RECURSIVE:
            return RecursiveCharacterTextSplitter(
                chunk_size=config.chunk_size,
                chunk_overlap=config.chunk_overlap,
                separators=["\n\n", "\n", " ", ""],
                **config.additional_params
            )
        elif config.strategy == ChunkingStrategy.CHARACTER:
            return CharacterTextSplitter(
                separator=config.separator,
                chunk_size=config.chunk_size,
                chunk_overlap=config.chunk_overlap,
                **config.additional_params
            )
        elif config.strategy == ChunkingStrategy.TOKEN:
            return TokenTextSplitter(
                chunk_size=config.chunk_size,
                chunk_overlap=config.chunk_overlap,
                **config.additional_params
            )
        else:
            raise ValueError(f"Unsupported chunking strategy: {config.strategy}")

    async def process_document(
        self,
        config_id: str,
        file_path: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> DocumentInfo:
        """
        处理文档：加载、切分、Embedding、存储

        Args:
            config_id: RAG 配置 ID
            file_path: 文件路径
            metadata: 文档元数据

        Returns:
            DocumentInfo
        """
        config = self.get_config(config_id)
        if not config:
            raise ValueError(f"RAG config '{config_id}' not found")

        # 生成文档 ID
        doc_id = hashlib.md5(f"{config_id}:{file_path}".encode()).hexdigest()

        # 创建文档信息
        doc_info = DocumentInfo(
            id=doc_id,
            config_id=config_id,
            filename=os.path.basename(file_path),
            file_path=file_path,
            file_type=self._get_document_type(file_path),
            file_size=os.path.getsize(file_path) if os.path.exists(file_path) else 0,
            status="processing",
            metadata=metadata or {}
        )
        self._documents[doc_id] = doc_info

        try:
            # 1. 加载文档
            loader = self._get_loader_for_document(file_path, config.document_loader)
            documents = loader.load()

            # 添加元数据
            for doc in documents:
                doc.metadata.update({
                    "source": file_path,
                    "config_id": config_id,
                    "doc_id": doc_id,
                    **(metadata or {})
                })

            # 2. 切分文档
            text_splitter = self._get_text_splitter(config.text_splitter)
            chunks = text_splitter.split_documents(documents)

            # 3. 获取 Embedding
            embeddings = self.embedding_provider.get_embedding(
                model=config.embedding.model
            )

            # 4. 存入 Vector Store
            vectorstore = await self._get_or_create_vectorstore(config_id, config, embeddings)
            await vectorstore.aadd_documents(chunks)

            # 更新文档信息
            doc_info.chunk_count = len(chunks)
            doc_info.status = "completed"
            doc_info.completed_at = datetime.now()

        except Exception as e:
            doc_info.status = "error"
            doc_info.error_message = str(e)
            raise

        return doc_info

    async def _get_or_create_vectorstore(
        self,
        config_id: str,
        config: RAGConfiguration,
        embeddings: Embeddings
    ) -> VectorStore:
        """获取或创建 Vector Store"""
        if config_id in self._vectorstores:
            return self._vectorstores[config_id]

        # 根据配置创建对应的 Vector Store
        if config.vectorstore.type == "qdrant":
            from langchain_qdrant import QdrantVectorStore

            store = await QdrantVectorStore.afrom_documents(
                documents=[],
                embedding=embeddings,
                url=config.vectorstore.qdrant_url,
                api_key=config.vectorstore.qdrant_api_key,
                collection_name=f"{config.vectorstore.collection_name}_{config_id}",
            )
        elif config.vectorstore.type == "chroma":
            from langchain_community.vectorstores import Chroma

            store = Chroma(
                embedding_function=embeddings,
                collection_name=f"{config.vectorstore.collection_name}_{config_id}",
            )
        else:
            raise ValueError(f"Unsupported vector store type: {config.vectorstore.type}")

        self._vectorstores[config_id] = store
        return store

    def _get_retriever(self, config_id: str) -> VectorStoreRetriever:
        """获取 Retriever"""
        if config_id in self._retrievers:
            return self._retrievers[config_id]

        config = self.get_config(config_id)
        if not config:
            raise ValueError(f"RAG config '{config_id}' not found")

        vectorstore = self._vectorstores.get(config_id)
        if not vectorstore:
            raise ValueError(f"Vector store for config '{config_id}' not found")

        # 根据配置创建 Retriever
        search_kwargs = {"k": config.retriever.top_k}

        if config.retriever.strategy == RetrievalStrategy.MMR:
            retriever = vectorstore.as_retriever(
                search_type="mmr",
                search_kwargs={
                    **search_kwargs,
                    "fetch_k": config.retriever.fetch_k,
                    "lambda_mult": config.retriever.lambda_mult,
                }
            )
        elif config.retriever.strategy == RetrievalStrategy.SIMILARITY_SCORE_THRESHOLD:
            retriever = vectorstore.as_retriever(
                search_type="similarity_score_threshold",
                search_kwargs={
                    **search_kwargs,
                    "score_threshold": config.retriever.score_threshold,
                }
            )
        else:
            retriever = vectorstore.as_retriever(
                search_kwargs=search_kwargs
            )

        self._retrievers[config_id] = retriever
        return retriever

    async def retrieve(
        self,
        config_id: str,
        query: str,
        top_k: Optional[int] = None
    ) -> List[Document]:
        """
        检索文档

        Args:
            config_id: RAG 配置 ID
            query: 查询文本
            top_k: 返回文档数量

        Returns:
            检索到的文档列表
        """
        retriever = self._get_retriever(config_id)

        if top_k:
            retriever.search_kwargs["k"] = top_k

        return await retriever.aget_relevant_documents(query)

    async def ask(
        self,
        config_id: str,
        question: str,
        streaming: bool = False,
        callbacks: Optional[List] = None
    ) -> Union[str, AsyncIterator[str]]:
        """
        RAG 问答

        Args:
            config_id: RAG 配置 ID
            question: 问题
            streaming: 是否流式输出
            callbacks: 回调列表

        Returns:
            答案字符串或流式迭代器
        """
        config = self.get_config(config_id)
        if not config:
            raise ValueError(f"RAG config '{config_id}' not found")

        llm = self.llm_provider.get_llm()
        retriever = self._get_retriever(config_id)

        if streaming:
            # 创建流式 RAG Chain
            from langchain.chains.combine_documents.stuff import create_stuff_documents_chain
            from langchain.chains.retrieval import create_retrieval_chain
            from langchain_core.prompts import ChatPromptTemplate

            system_prompt = config.rag_chain.system_prompt or (
                "You are an assistant for question-answering tasks. "
                "Use the following pieces of retrieved context to answer the question. "
                "If you don't know the answer, say that you don't know."
            )

            prompt = ChatPromptTemplate.from_messages([
                ("system", system_prompt + "\n\n{context}"),
                ("human", "{input}")
            ])

            combine_docs_chain = create_stuff_documents_chain(llm, prompt)
            rag_chain = create_retrieval_chain(retriever, combine_docs_chain)

            return rag_chain.astream({"input": question}, config={"callbacks": callbacks})
        else:
            # 非流式执行 - 使用 LCEL 方式
            from langchain_core.prompts import ChatPromptTemplate

            system_prompt = config.rag_chain.system_prompt or (
                "You are an assistant for question-answering tasks. "
                "Use the following pieces of retrieved context to answer the question. "
                "If you don't know the answer, say that you don't know.\n\n"
                "Context: {context}"
            )

            prompt = ChatPromptTemplate.from_messages([
                ("system", system_prompt),
                ("human", "{input}")
            ])

            # 检索文档
            docs = await retriever.ainvoke(question)
            context = "\n\n".join([doc.page_content for doc in docs])

            # 格式化提示
            messages = prompt.format_messages(input=question, context=context)

            # 调用 LLM
            response = await llm.ainvoke(messages, config={"callbacks": callbacks})

            return response.content if hasattr(response, 'content') else str(response)

    def get_document_info(self, document_id: str) -> Optional[DocumentInfo]:
        """获取文档信息"""
        return self._documents.get(document_id)

    def list_documents(self, config_id: Optional[str] = None) -> List[DocumentInfo]:
        """列出文档"""
        docs = list(self._documents.values())
        if config_id:
            docs = [d for d in docs if d.config_id == config_id]
        return docs

    async def delete_document(self, document_id: str) -> bool:
        """删除文档"""
        doc = self._documents.get(document_id)
        if not doc:
            return False

        # 从 Vector Store 中删除
        config = self.get_config(doc.config_id)
        if config:
            vectorstore = self._vectorstores.get(doc.config_id)
            if vectorstore:
                # 根据 metadata 过滤删除
                # 注意：具体实现取决于 Vector Store 类型
                pass

        del self._documents[document_id]
        return True
