"""
Skills 模块 - 基于 LCEL 的技能编排
"""

from typing import Dict, Any, Optional, List, AsyncIterator, Union, Callable
from pydantic import BaseModel, Field
import json
import yaml

from langchain_core.runnables import (
    Runnable,
    RunnableConfig,
    RunnableSequence,
    RunnableParallel,
    RunnableLambda,
    RunnableBranch,
)
from langchain_core.prompts import ChatPromptTemplate, PromptTemplate
from langchain_core.output_parsers import StrOutputParser, JsonOutputParser
from langchain_core.tools import BaseTool


class SkillInputSchema(BaseModel):
    """Skill 输入 Schema"""
    type: str = "object"
    properties: Dict[str, Any] = Field(default_factory=dict)
    required: List[str] = Field(default_factory=list)


class SkillOutputSchema(BaseModel):
    """Skill 输出 Schema"""
    type: str = "string"
    description: Optional[str] = None


class SkillMetadata(BaseModel):
    """Skill 元数据"""
    author: Optional[str] = None
    version: str = "1.0.0"
    tags: List[str] = Field(default_factory=list)
    category: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None


class SkillDefinition(BaseModel):
    """
    Skill 定义

    完整的 Skill 配置，包含 LCEL Chain 定义
    """
    id: str
    name: str
    description: str
    version: str = "1.0.0"

    # LCEL Chain 配置
    chain_type: str = "sequence"  # sequence, parallel, branch, lambda
    chain_config: Dict[str, Any] = Field(default_factory=dict)

    # 输入输出 Schema
    input_schema: SkillInputSchema = Field(default_factory=SkillInputSchema)
    output_schema: SkillOutputSchema = Field(default_factory=SkillOutputSchema)

    # 依赖
    dependencies: List[str] = Field(default_factory=list)
    required_tools: List[str] = Field(default_factory=list)

    # 元数据
    metadata: SkillMetadata = Field(default_factory=SkillMetadata)

    # 启用状态
    enabled: bool = True

    class Config:
        extra = "allow"


class SkillOrchestrator:
    """
    Skill 编排器 - 基于 LCEL

    提供 Skill 的创建、管理和执行能力
    """

    def __init__(self, llm_provider):
        self.llm_provider = llm_provider
        self._skills: Dict[str, SkillDefinition] = {}
        self._chains: Dict[str, Runnable] = {}
        self._templates: Dict[str, ChatPromptTemplate] = {}
        self._prompts: Dict[str, PromptTemplate] = {}

    async def initialize(self):
        """初始化内置 Skill 模板"""
        # 注册常用 Prompt 模板
        self._register_builtin_prompts()

        # 注册示例 Skills
        await self._register_example_skills()

    def _register_builtin_prompts(self):
        """注册内置 Prompt 模板"""
        # QA 模板
        self._templates["qa"] = ChatPromptTemplate.from_messages([
            ("system", "You are a helpful assistant. Answer the question based on the provided context."),
            ("human", "Context: {context}\n\nQuestion: {question}")
        ])

        # 总结模板
        self._templates["summarize"] = ChatPromptTemplate.from_messages([
            ("system", "You are a summarization expert. Provide a concise summary of the given text."),
            ("human", "Please summarize the following text:\n\n{text}")
        ])

        # 翻译模板
        self._templates["translate"] = ChatPromptTemplate.from_messages([
            ("system", "You are a professional translator."),
            ("human", "Translate the following text from {source_lang} to {target_lang}:\n\n{text}")
        ])

        # 提取模板
        self._templates["extract"] = ChatPromptTemplate.from_messages([
            ("system", "You are an information extraction expert. Extract the requested information in JSON format."),
            ("human", "Extract {extraction_target} from the following text:\n\n{text}\n\nReturn the result as JSON.")
        ])

    async def _register_example_skills(self):
        """注册示例 Skills"""
        # 简单 QA Skill
        qa_skill = SkillDefinition(
            id="qa-basic",
            name="Basic QA",
            description="Answer questions based on context",
            chain_type="sequence",
            chain_config={
                "prompt_template": "qa",
                "output_parser": "str"
            }
        )
        self.register_skill(qa_skill)

        # 总结 Skill
        summarize_skill = SkillDefinition(
            id="summarize-basic",
            name="Basic Summarization",
            description="Summarize long texts",
            chain_type="sequence",
            chain_config={
                "prompt_template": "summarize",
                "output_parser": "str"
            }
        )
        self.register_skill(summarize_skill)

    def create_skill(
        self,
        definition: SkillDefinition,
        tools: Optional[List[BaseTool]] = None
    ) -> Runnable:
        """
        根据定义创建 LCEL Chain

        Args:
            definition: Skill 定义
            tools: 可选的 Tools 列表

        Returns:
            LCEL Runnable
        """
        if definition.chain_type == "sequence":
            chain = self._create_sequence_chain(definition, tools)
        elif definition.chain_type == "parallel":
            chain = self._create_parallel_chain(definition, tools)
        elif definition.chain_type == "branch":
            chain = self._create_branch_chain(definition, tools)
        elif definition.chain_type == "lambda":
            chain = self._create_lambda_chain(definition, tools)
        else:
            raise ValueError(f"Unsupported chain type: {definition.chain_type}")

        # 缓存 chain
        self._chains[definition.id] = chain
        return chain

    def _create_sequence_chain(
        self,
        definition: SkillDefinition,
        tools: Optional[List[BaseTool]]
    ) -> Runnable:
        """创建序列 Chain"""
        llm = self.llm_provider.get_llm()

        # 获取 Prompt 模板
        template_name = definition.chain_config.get("prompt_template", "qa")
        prompt = self._templates.get(template_name)

        if not prompt:
            raise ValueError(f"Prompt template '{template_name}' not found")

        # 构建 Chain
        chain = prompt | llm

        # 添加输出解析器
        output_parser = definition.chain_config.get("output_parser")
        if output_parser == "str":
            from langchain_core.output_parsers import StrOutputParser
            chain = chain | StrOutputParser()
        elif output_parser == "json":
            from langchain_core.output_parsers import JsonOutputParser
            chain = chain | JsonOutputParser()

        # 绑定 Tools
        if tools:
            chain = chain.bind(tools=tools)

        return chain

    def _create_parallel_chain(
        self,
        definition: SkillDefinition,
        tools: Optional[List[BaseTool]]
    ) -> Runnable:
        """创建并行 Chain"""
        # 实现并行执行逻辑
        branches = definition.chain_config.get("branches", [])
        runnables = {}

        for branch in branches:
            branch_id = branch["id"]
            branch_skill = self._skills.get(branch_id)
            if branch_skill:
                runnables[branch_id] = self.create_skill(branch_skill, tools)

        return RunnableParallel(runnables)

    def _create_branch_chain(
        self,
        definition: SkillDefinition,
        tools: Optional[List[BaseTool]]
    ) -> Runnable:
        """创建分支 Chain"""
        # 实现条件分支逻辑
        conditions = definition.chain_config.get("conditions", [])
        branches = []

        for condition in conditions:
            predicate = self._create_condition_predicate(condition["condition"])
            branch_id = condition["branch_id"]
            branch_skill = self._skills.get(branch_id)
            if branch_skill:
                branch_runnable = self.create_skill(branch_skill, tools)
                branches.append((predicate, branch_runnable))

        default_branch_id = definition.chain_config.get("default_branch")
        default = None
        if default_branch_id:
            default_skill = self._skills.get(default_branch_id)
            if default_skill:
                default = self.create_skill(default_skill, tools)

        return RunnableBranch(*branches, default=default)

    def _create_lambda_chain(
        self,
        definition: SkillDefinition,
        tools: Optional[List[BaseTool]]
    ) -> Runnable:
        """创建 Lambda Chain"""
        lambda_expr = definition.chain_config.get("lambda")
        # 这里需要安全地执行 lambda 表达式
        # 实际实现中应该使用更安全的方式
        func = eval(lambda_expr)  # noqa: S307 - 需要更安全的实现
        return RunnableLambda(func)

    def _create_condition_predicate(self, condition: str):
        """创建条件判断函数"""
        # 简化实现，实际应该使用更复杂的条件解析
        def predicate(x):
            return eval(condition, {"x": x})  # noqa: S307 - 需要更安全的实现
        return predicate

    def register_skill(self, definition: SkillDefinition) -> Runnable:
        """
        注册 Skill

        Args:
            definition: Skill 定义

        Returns:
            创建的 Chain
        """
        self._skills[definition.id] = definition
        return self.create_skill(definition)

    def get_skill(self, skill_id: str) -> Optional[SkillDefinition]:
        """
        获取 Skill 定义

        Args:
            skill_id: Skill ID

        Returns:
            SkillDefinition 或 None
        """
        return self._skills.get(skill_id)

    def get_chain(self, skill_id: str) -> Optional[Runnable]:
        """
        获取已创建的 Chain

        Args:
            skill_id: Skill ID

        Returns:
            Runnable 或 None
        """
        return self._chains.get(skill_id)

    def list_skills(self) -> List[Dict[str, Any]]:
        """
        列出所有 Skills

        Returns:
            Skill 列表
        """
        return [
            {
                "id": skill.id,
                "name": skill.name,
                "description": skill.description,
                "version": skill.version,
                "chain_type": skill.chain_type,
                "enabled": skill.enabled,
                "dependencies": skill.dependencies,
            }
            for skill in self._skills.values()
        ]

    async def invoke(
        self,
        skill_id: str,
        input_data: Dict[str, Any],
        config: Optional[RunnableConfig] = None
    ) -> Any:
        """
        执行 Skill

        Args:
            skill_id: Skill ID
            input_data: 输入数据
            config: 运行配置

        Returns:
            执行结果
        """
        chain = self.get_chain(skill_id)
        if not chain:
            raise ValueError(f"Skill '{skill_id}' not found")

        return await chain.ainvoke(input_data, config=config)

    async def stream(
        self,
        skill_id: str,
        input_data: Dict[str, Any],
        config: Optional[RunnableConfig] = None
    ) -> AsyncIterator[Any]:
        """
        流式执行 Skill

        Args:
            skill_id: Skill ID
            input_data: 输入数据
            config: 运行配置

        Yields:
            流式输出块
        """
        chain = self.get_chain(skill_id)
        if not chain:
            raise ValueError(f"Skill '{skill_id}' not found")

        async for chunk in chain.astream(input_data, config=config):
            yield chunk

    def remove_skill(self, skill_id: str):
        """
        移除 Skill

        Args:
            skill_id: Skill ID
        """
        self._skills.pop(skill_id, None)
        self._chains.pop(skill_id, None)

    def update_skill(self, skill_id: str, definition: SkillDefinition) -> Runnable:
        """
        更新 Skill

        Args:
            skill_id: Skill ID
            definition: 新的 Skill 定义

        Returns:
            新的 Chain
        """
        self.remove_skill(skill_id)
        return self.register_skill(definition)

    def export_skill(self, skill_id: str, format: str = "json") -> str:
        """
        导出 Skill

        Args:
            skill_id: Skill ID
            format: 导出格式 (json, yaml)

        Returns:
            导出的字符串
        """
        skill = self.get_skill(skill_id)
        if not skill:
            raise ValueError(f"Skill '{skill_id}' not found")

        if format == "json":
            return json.dumps(skill.model_dump(), indent=2, ensure_ascii=False)
        elif format == "yaml":
            return yaml.dump(skill.model_dump(), allow_unicode=True, sort_keys=False)
        else:
            raise ValueError(f"Unsupported format: {format}")

    def import_skill(self, data: str, format: str = "json") -> SkillDefinition:
        """
        导入 Skill

        Args:
            data: 导入的数据
            format: 导入格式 (json, yaml)

        Returns:
            SkillDefinition
        """
        if format == "json":
            data_dict = json.loads(data)
        elif format == "yaml":
            data_dict = yaml.safe_load(data)
        else:
            raise ValueError(f"Unsupported format: {format}")

        return SkillDefinition(**data_dict)
