"""
LangChain 状态机 - 团队编排

使用 LCEL (LangChain Expression Language) 实现的工作流编排
支持: supervisor, pipeline, parallel, reflection, debate 模式
"""

import asyncio
import json
import re
from typing import List, Dict, Optional, Any, AsyncIterator, Callable
from dataclasses import dataclass, field
from enum import Enum

from langchain_core.runnables import (
    Runnable,
    RunnableConfig,
    RunnableLambda,
    RunnableParallel,
    RunnableBranch,
    RunnablePassthrough,
)
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.messages import HumanMessage, AIMessage

from ...models.schemas import TaskRequest, OrchestrationNode


class OrchestratorState(Enum):
    """编排器状态"""
    IDLE = "idle"
    INITIALIZING = "initializing"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    ERROR = "error"


@dataclass
class StepContext:
    """步骤上下文"""
    step_index: int
    agent_id: str
    input_message: str
    output_message: str = ""
    status: str = "pending"  # pending, running, completed, error
    timestamp: float = field(default_factory=lambda: asyncio.get_event_loop().time())


@dataclass
class OrchestrationContext:
    """编排上下文"""
    node: OrchestrationNode
    user_message: str
    history: List[Dict]
    team_context: Dict
    agents_map: Dict[str, Dict]
    state: OrchestratorState = OrchestratorState.IDLE
    current_step: int = 0
    total_steps: int = 0
    steps: List[StepContext] = field(default_factory=list)
    final_result: str = ""
    error_message: str = ""
    trace_id: Optional[str] = None

    def get_agent_name(self, agent_id: str) -> str:
        """获取 Agent 名称"""
        return self.agents_map.get(agent_id, {}).get("name", agent_id)

    def to_dict(self) -> Dict:
        """转换为字典"""
        return {
            "state": self.state.value,
            "current_step": self.current_step,
            "total_steps": self.total_steps,
            "steps": [
                {
                    "step_index": s.step_index,
                    "agent_id": s.agent_id,
                    "agent_name": self.get_agent_name(s.agent_id),
                    "input": s.input_message[:100] + "..." if len(s.input_message) > 100 else s.input_message,
                    "output": s.output_message[:100] + "..." if len(s.output_message) > 100 else s.output_message,
                    "status": s.status,
                }
                for s in self.steps
            ],
            "final_result": self.final_result[:500] + "..." if len(self.final_result) > 500 else self.final_result,
            "error_message": self.error_message,
        }


class LangChainOrchestrator:
    """
    LangChain 编排器状态机

    使用 LCEL 构建工作流，支持多种编排模式
    """

    def __init__(self, llm_provider=None, trace_manager=None):
        self.llm_provider = llm_provider
        self.trace_manager = trace_manager
        self._workflows: Dict[str, Runnable] = {}
        self._active_contexts: Dict[str, OrchestrationContext] = {}

    async def initialize(self):
        """初始化编排器"""
        pass

    def _create_agent_runner(self, agent_id: str) -> Callable:
        """创建 Agent 运行器"""
        from ..agent_runner import run_agent_task, stream_agent_task

        async def run_agent(input_data: Dict) -> str:
            """运行 Agent（非流式）"""
            request = TaskRequest(
                message=input_data.get("message", ""),
                history=input_data.get("history", []),
                team_context=input_data.get("team_context", {}),
            )
            result = await run_agent_task(agent_id, request)
            return result.get("content", "")

        return run_agent

    def _create_streaming_agent_runner(self, agent_id: str) -> Callable:
        """创建流式 Agent 运行器"""
        from ..agent_runner import stream_agent_task

        async def stream_agent(input_data: Dict) -> AsyncIterator[str]:
            """流式运行 Agent"""
            request = TaskRequest(
                message=input_data.get("message", ""),
                history=input_data.get("history", []),
                team_context=input_data.get("team_context", {}),
            )

            full_content = ""
            async for sse_line in stream_agent_task(agent_id, request):
                if sse_line.startswith("data: "):
                    payload = sse_line[6:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        data = json.loads(payload)
                        if "content" in data:
                            full_content += data["content"]
                            yield data["content"]
                    except:
                        pass

        return stream_agent

    def _build_supervisor_workflow(self, context: OrchestrationContext) -> Runnable:
        """构建 Supervisor 工作流"""

        async def supervisor_step(state: Dict) -> Dict:
            """Supervisor 步骤"""
            tl_id = context.team_context.get("tl_id") or (context.node.agents[0] if context.node.agents else None)
            if not tl_id:
                return {"error": "No Team Lead"}

            current_query = state.get("message", context.user_message)
            max_iterations = 5

            for iteration in range(max_iterations):
                # 创建步骤上下文
                step = StepContext(
                    step_index=iteration,
                    agent_id=tl_id,
                    input_message=current_query,
                    status="running"
                )
                context.steps.append(step)
                context.current_step = iteration

                # 运行 Team Lead
                run_agent = self._create_agent_runner(tl_id)
                result = await run_agent({
                    "message": current_query,
                    "history": context.history,
                    "team_context": context.team_context,
                })

                step.output_message = result
                step.status = "completed"

                # 检查是否需要委派
                match = re.search(
                    r"\[DELEGATE:\s*@([^\s\]]+)\]\s*(.+)",
                    result,
                    re.IGNORECASE | re.DOTALL
                )

                if match:
                    target_name = match.group(1)
                    subtask = match.group(2)

                    # 查找目标 Agent
                    target = next(
                        (m for m in context.team_context.get("members", [])
                         if m["name"].lower() == target_name.lower()),
                        None,
                    )

                    if target:
                        # 运行子任务
                        sub_step = StepContext(
                            step_index=iteration,
                            agent_id=target["id"],
                            input_message=subtask,
                            status="running"
                        )
                        context.steps.append(sub_step)

                        sub_run_agent = self._create_agent_runner(target["id"])
                        sub_result = await sub_run_agent({
                            "message": subtask,
                            "history": context.history,
                            "team_context": context.team_context,
                        })

                        sub_step.output_message = sub_result
                        sub_step.status = "completed"

                        current_query = f"Result from {target_name}: {sub_result}\n\nPlease proceed."
                        continue

                # 完成
                context.final_result = result
                context.state = OrchestratorState.COMPLETED
                return {"final": result, "completed": True}

            return {"final": context.final_result, "completed": True}

        return RunnableLambda(supervisor_step)

    def _build_pipeline_workflow(self, context: OrchestrationContext) -> Runnable:
        """构建 Pipeline 工作流"""

        async def pipeline_step(state: Dict) -> Dict:
            """Pipeline 步骤"""
            current_input = state.get("message", context.user_message)
            last_output = ""

            agents = context.node.agents
            total_steps = len(agents)
            context.total_steps = total_steps

            for idx, agent_id in enumerate(agents):
                # 创建步骤上下文
                step = StepContext(
                    step_index=idx,
                    agent_id=agent_id,
                    input_message=current_input,
                    status="running"
                )
                context.steps.append(step)
                context.current_step = idx

                # 运行 Agent
                run_agent = self._create_agent_runner(agent_id)
                result = await run_agent({
                    "message": current_input,
                    "history": context.history,
                    "team_context": context.team_context,
                })

                step.output_message = result
                step.status = "completed"
                last_output = result

                # 更新下一步的输入
                current_input = f"Previous output: {last_output}\n\nTask: Continue. Goal: {context.user_message}"

            context.final_result = last_output
            context.state = OrchestratorState.COMPLETED
            return {"final": last_output, "completed": True}

        return RunnableLambda(pipeline_step)

    def _build_parallel_workflow(self, context: OrchestrationContext) -> Runnable:
        """构建 Parallel 工作流"""

        async def parallel_step(state: Dict) -> Dict:
            """Parallel 步骤"""
            agents = context.node.agents
            message = state.get("message", context.user_message)

            context.total_steps = len(agents)

            # 创建并行任务
            async def run_parallel_agent(agent_id: str, idx: int) -> Dict:
                step = StepContext(
                    step_index=idx,
                    agent_id=agent_id,
                    input_message=message,
                    status="running"
                )
                context.steps.append(step)

                run_agent = self._create_agent_runner(agent_id)
                result = await run_agent({
                    "message": message,
                    "history": context.history,
                    "team_context": context.team_context,
                })

                step.output_message = result
                step.status = "completed"

                return {"agent_id": agent_id, "result": result}

            # 并行执行
            tasks = [
                run_parallel_agent(agent_id, idx)
                for idx, agent_id in enumerate(agents)
            ]
            results = await asyncio.gather(*tasks)

            # 合并结果
            combined = "\n\n".join(
                f"--- {context.get_agent_name(r['agent_id'])} ---\n{r['result']}"
                for r in results
            )

            # 总结
            summary_id = agents[0] if agents else context.team_context.get("tl_id")
            summary_step = StepContext(
                step_index=len(agents),
                agent_id=summary_id,
                input_message=f"Synthesize these results:\n\n{combined}",
                status="running"
            )
            context.steps.append(summary_step)

            summary_run = self._create_agent_runner(summary_id)
            summary_result = await summary_run({
                "message": f"Synthesize these results:\n\n{combined}",
                "history": context.history,
                "team_context": context.team_context,
            })

            summary_step.output_message = summary_result
            summary_step.status = "completed"

            context.final_result = summary_result
            context.state = OrchestratorState.COMPLETED
            return {"final": summary_result, "completed": True}

        return RunnableLambda(parallel_step)

    def _build_reflection_workflow(self, context: OrchestrationContext) -> Runnable:
        """构建 Reflection 工作流"""

        async def reflection_step(state: Dict) -> Dict:
            """Reflection 步骤"""
            agents = context.node.agents
            if len(agents) < 2:
                return {"error": "Need 2 agents"}

            gen_id, rev_id = agents[0], agents[1]
            max_loops = (context.node.config or {}).get("max_loops", 2)
            feedback = "Initial"
            curr_draft = ""

            for loop_idx in range(max_loops):
                # Generator step
                gen_step = StepContext(
                    step_index=loop_idx * 2,
                    agent_id=gen_id,
                    input_message=f"Task: {context.user_message}\nFeedback: {feedback}",
                    status="running"
                )
                context.steps.append(gen_step)

                gen_run = self._create_agent_runner(gen_id)
                curr_draft = await gen_run({
                    "message": f"Task: {context.user_message}\nFeedback: {feedback}",
                    "history": context.history,
                    "team_context": context.team_context,
                })

                gen_step.output_message = curr_draft
                gen_step.status = "completed"

                # Reviewer step
                rev_step = StepContext(
                    step_index=loop_idx * 2 + 1,
                    agent_id=rev_id,
                    input_message=f"Review: {curr_draft}. If perfect say 'APPROVED'.",
                    status="running"
                )
                context.steps.append(rev_step)

                rev_run = self._create_agent_runner(rev_id)
                feedback = await rev_run({
                    "message": f"Review: {curr_draft}. If perfect say 'APPROVED'.",
                    "history": context.history,
                    "team_context": context.team_context,
                })

                rev_step.output_message = feedback
                rev_step.status = "completed"

                if "APPROVED" in feedback.upper():
                    break

            context.final_result = curr_draft
            context.state = OrchestratorState.COMPLETED
            return {"final": curr_draft, "completed": True}

        return RunnableLambda(reflection_step)

    def _build_debate_workflow(self, context: OrchestrationContext) -> Runnable:
        """构建 Debate 工作流"""

        async def debate_step(state: Dict) -> Dict:
            """Debate 步骤"""
            agents = context.node.agents
            if len(agents) < 2:
                return {"error": "Need 2 agents"}

            a_id, b_id = agents[0], agents[1]

            # Agent A
            a_step = StepContext(
                step_index=0,
                agent_id=a_id,
                input_message=f"Topic: {context.user_message}\nYour view?",
                status="running"
            )
            context.steps.append(a_step)

            a_run = self._create_agent_runner(a_id)
            a_content = await a_run({
                "message": f"Topic: {context.user_message}\nYour view?",
                "history": context.history,
                "team_context": context.team_context,
            })

            a_step.output_message = a_content
            a_step.status = "completed"

            # Agent B
            b_step = StepContext(
                step_index=1,
                agent_id=b_id,
                input_message=f"Topic: {context.user_message}\nAgent A says: {a_content}\nCounter?",
                status="running"
            )
            context.steps.append(b_step)

            b_run = self._create_agent_runner(b_id)
            b_content = await b_run({
                "message": f"Topic: {context.user_message}\nAgent A says: {a_content}\nCounter?",
                "history": context.history,
                "team_context": context.team_context,
            })

            b_step.output_message = b_content
            b_step.status = "completed"

            # Final synthesis
            final_step = StepContext(
                step_index=2,
                agent_id=a_id,
                input_message=f"Synthesis based on critique: {b_content}",
                status="running"
            )
            context.steps.append(final_step)

            final_run = self._create_agent_runner(a_id)
            final_content = await final_run({
                "message": f"Synthesis based on critique: {b_content}",
                "history": context.history,
                "team_context": context.team_context,
            })

            final_step.output_message = final_content
            final_step.status = "completed"

            context.final_result = final_content
            context.state = OrchestratorState.COMPLETED
            return {"final": final_content, "completed": True}

        return RunnableLambda(debate_step)

    def build_workflow(self, context: OrchestrationContext) -> Runnable:
        """根据编排模式构建工作流"""
        mode = context.node.mode.lower()

        workflow_builders = {
            "supervisor": self._build_supervisor_workflow,
            "pipeline": self._build_pipeline_workflow,
            "parallel": self._build_parallel_workflow,
            "reflection": self._build_reflection_workflow,
            "debate": self._build_debate_workflow,
        }

        builder = workflow_builders.get(mode)
        if not builder:
            raise ValueError(f"Unknown workflow mode: {mode}")

        return builder(context)

    async def execute(
        self,
        context: OrchestrationContext,
        streaming: bool = False
    ) -> Dict[str, Any]:
        """执行编排工作流"""
        try:
            context.state = OrchestratorState.INITIALIZING

            # 构建工作流
            workflow = self.build_workflow(context)

            # 准备输入
            inputs = {
                "message": context.user_message,
                "history": context.history,
                "team_context": context.team_context,
            }

            # 执行工作流
            context.state = OrchestratorState.RUNNING

            # 获取回调
            callbacks = []
            if self.trace_manager:
                from .trace import TraceCallbackHandler
                handler = self.trace_manager.get_callback_handler(
                    session_id=context.trace_id,
                    agent_id="orchestrator",
                )
                callbacks.append(handler)

            result = await workflow.ainvoke(
                inputs,
                config=RunnableConfig(callbacks=callbacks) if callbacks else None
            )

            return result

        except Exception as e:
            context.state = OrchestratorState.ERROR
            context.error_message = str(e)
            raise

    async def stream_execute(
        self,
        context: OrchestrationContext,
    ) -> AsyncIterator[Dict[str, Any]]:
        """流式执行编排工作流"""
        try:
            context.state = OrchestratorState.INITIALIZING

            # 获取模式
            mode = context.node.mode.lower()

            # 根据模式选择流式执行策略
            stream_handlers = {
                "supervisor": self._stream_supervisor,
                "pipeline": self._stream_pipeline,
                "parallel": self._stream_parallel,
                "reflection": self._stream_reflection,
                "debate": self._stream_debate,
            }

            handler = stream_handlers.get(mode)
            if not handler:
                raise ValueError(f"Unknown workflow mode: {mode}")

            # 执行流式处理
            context.state = OrchestratorState.RUNNING
            async for event in handler(context):
                yield event

        except Exception as e:
            context.state = OrchestratorState.ERROR
            context.error_message = str(e)
            yield {"error": str(e)}

    async def _stream_agent(
        self,
        agent_id: str,
        message: str,
        context: OrchestrationContext,
    ) -> AsyncIterator[Dict[str, Any]]:
        """流式执行单个 Agent"""
        from ..agent_runner import stream_agent_task

        request = TaskRequest(
            message=message,
            history=context.history,
            team_context=context.team_context,
        )

        agent_name = context.get_agent_name(agent_id)
        full_content = ""

        async for sse_line in stream_agent_task(agent_id, request):
            if not sse_line.startswith("data: "):
                continue

            payload = sse_line[6:].strip()
            if payload == "[DONE]":
                yield {
                    "agent": agent_name,
                    "agent_id": agent_id,
                    "done": True,
                }
                break

            try:
                data = json.loads(payload)

                if "todos" in data:
                    yield {"todos": data["todos"], "agent_id": agent_id}
                    continue

                if "error" in data:
                    yield {
                        "agent": agent_name,
                        "agent_id": agent_id,
                        "error": data["error"],
                    }
                    break

                chunk = data.get("content", "")
                reasoning = data.get("reasoning", "")
                full_content += chunk

                yield {
                    "agent": agent_name,
                    "agent_id": agent_id,
                    "content": chunk,
                    "reasoning": reasoning,
                }

            except Exception:
                pass

    async def _stream_supervisor(
        self,
        context: OrchestrationContext,
    ) -> AsyncIterator[Dict[str, Any]]:
        """流式 Supervisor 模式"""
        tl_id = context.team_context.get("tl_id") or (context.node.agents[0] if context.node.agents else None)
        if not tl_id:
            yield {"error": "No Team Lead"}
            return

        current_query = context.user_message
        max_iterations = 5

        for iteration in range(max_iterations):
            # 运行 Team Lead
            tl_content = ""
            async for event in self._stream_agent(tl_id, current_query, context):
                if "content" in event:
                    tl_content += event.get("content", "")
                yield event

            # 检查是否需要委派
            match = re.search(
                r"\[DELEGATE:\s*@([^\s\]]+)\]\s*(.+)",
                tl_content,
                re.IGNORECASE | re.DOTALL
            )

            if match:
                target_name = match.group(1)
                subtask = match.group(2)

                # 查找目标 Agent
                target = next(
                    (m for m in context.team_context.get("members", [])
                     if m["name"].lower() == target_name.lower()),
                    None,
                )

                if target:
                    # 运行子任务
                    sub_content = ""
                    async for event in self._stream_agent(target["id"], subtask, context):
                        if "content" in event:
                            sub_content += event.get("content", "")
                        yield event

                    current_query = f"Result from {target_name}: {sub_content}\n\nPlease proceed."
                    continue

            # 完成
            yield {"orchestration_done": True, "final": tl_content}
            context.final_result = tl_content
            context.state = OrchestratorState.COMPLETED
            return

        yield {"orchestration_done": True, "final": context.final_result}

    async def _stream_pipeline(
        self,
        context: OrchestrationContext,
    ) -> AsyncIterator[Dict[str, Any]]:
        """流式 Pipeline 模式"""
        current_input = context.user_message
        last_output = ""

        agents = context.node.agents
        total_steps = len(agents)

        for idx, agent_id in enumerate(agents):
            context.current_step = idx
            context.total_steps = total_steps

            last_output = ""
            async for event in self._stream_agent(agent_id, current_input, context):
                if "content" in event:
                    last_output += event.get("content", "")
                yield event

            current_input = f"Previous output: {last_output}\n\nTask: Continue. Goal: {context.user_message}"

        context.final_result = last_output
        context.state = OrchestratorState.COMPLETED
        yield {"orchestration_done": True, "final": last_output}

    async def _stream_parallel(
        self,
        context: OrchestrationContext,
    ) -> AsyncIterator[Dict[str, Any]]:
        """流式 Parallel 模式"""
        agents = context.node.agents
        message = context.user_message

        context.total_steps = len(agents)

        # 收集队列
        queue: asyncio.Queue = asyncio.Queue()
        collected_per_agent: Dict[str, str] = {aid: "" for aid in agents}

        async def feed(agent_id: str):
            async for event in self._stream_agent(agent_id, message, context):
                await queue.put((agent_id, event))
            await queue.put((agent_id, None))  # sentinel

        done_count = 0
        tasks = [asyncio.create_task(feed(aid)) for aid in agents]
        total = len(agents)

        while done_count < total:
            agent_id, event = await queue.get()
            if event is None:
                done_count += 1
                continue

            if "content" in event:
                collected_per_agent[agent_id] = collected_per_agent.get(agent_id, "") + event.get("content", "")
            yield event

        # 总结
        combined = "\n\n".join(
            f"--- {context.get_agent_name(aid)} ---\n{content}"
            for aid, content in collected_per_agent.items()
        )

        summary_id = agents[0] if agents else context.team_context.get("tl_id")
        summary_content = ""

        async for event in self._stream_agent(summary_id, f"Synthesize these results:\n\n{combined}", context):
            if "content" in event:
                summary_content += event.get("content", "")
            yield event

        context.final_result = summary_content
        context.state = OrchestratorState.COMPLETED
        yield {"orchestration_done": True, "final": summary_content}

    async def _stream_reflection(
        self,
        context: OrchestrationContext,
    ) -> AsyncIterator[Dict[str, Any]]:
        """流式 Reflection 模式"""
        agents = context.node.agents
        if len(agents) < 2:
            yield {"error": "Need 2 agents"}
            return

        gen_id, rev_id = agents[0], agents[1]
        max_loops = (context.node.config or {}).get("max_loops", 2)
        feedback = "Initial"
        curr_draft = ""

        for loop_idx in range(max_loops):
            # Generator
            curr_draft = ""
            async for event in self._stream_agent(gen_id, f"Task: {context.user_message}\nFeedback: {feedback}", context):
                if "content" in event:
                    curr_draft += event.get("content", "")
                yield event

            # Reviewer
            feedback = ""
            async for event in self._stream_agent(rev_id, f"Review: {curr_draft}. If perfect say 'APPROVED'.", context):
                if "content" in event:
                    feedback += event.get("content", "")
                yield event

            if "APPROVED" in feedback.upper():
                break

        context.final_result = curr_draft
        context.state = OrchestratorState.COMPLETED
        yield {"orchestration_done": True, "final": curr_draft}

    async def _stream_debate(
        self,
        context: OrchestrationContext,
    ) -> AsyncIterator[Dict[str, Any]]:
        """流式 Debate 模式"""
        agents = context.node.agents
        if len(agents) < 2:
            yield {"error": "Need 2 agents"}
            return

        a_id, b_id = agents[0], agents[1]

        # Agent A
        a_content = ""
        async for event in self._stream_agent(a_id, f"Topic: {context.user_message}\nYour view?", context):
            if "content" in event:
                a_content += event.get("content", "")
            yield event

        # Agent B
        b_content = ""
        async for event in self._stream_agent(b_id, f"Topic: {context.user_message}\nAgent A says: {a_content}\nCounter?", context):
            if "content" in event:
                b_content += event.get("content", "")
            yield event

        # Final synthesis
        final_content = ""
        async for event in self._stream_agent(a_id, f"Synthesis based on critique: {b_content}", context):
            if "content" in event:
                final_content += event.get("content", "")
            yield event

        context.final_result = final_content
        context.state = OrchestratorState.COMPLETED
        yield {"orchestration_done": True, "final": final_content}

    # ──────────────────────────────────────────────────────────────────────────
    # 公共 API
    # ──────────────────────────────────────────────────────────────────────────

    async def run_team_task(
        self,
        node: OrchestrationNode,
        user_message: str,
        history: List[Dict],
        team_context: Dict,
        agents_map: Dict[str, Dict],
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """运行团队任务（非流式）"""
        context = OrchestrationContext(
            node=node,
            user_message=user_message,
            history=history,
            team_context=team_context,
            agents_map=agents_map,
            trace_id=trace_id,
        )

        workflow = self.build_workflow(context)

        # 获取回调
        callbacks = []
        if self.trace_manager and trace_id:
            from .trace import TraceCallbackHandler
            handler = self.trace_manager.get_callback_handler(
                session_id=trace_id,
                agent_id="orchestrator",
            )
            callbacks.append(handler)

        result = await workflow.ainvoke(
            {"message": user_message},
            config=RunnableConfig(callbacks=callbacks) if callbacks else None
        )

        return result

    async def stream_team_task(
        self,
        node: OrchestrationNode,
        user_message: str,
        history: List[Dict],
        team_context: Dict,
        agents_map: Dict[str, Dict],
        trace_id: Optional[str] = None,
    ) -> AsyncIterator[Dict[str, Any]]:
        """流式运行团队任务"""
        context = OrchestrationContext(
            node=node,
            user_message=user_message,
            history=history,
            team_context=team_context,
            agents_map=agents_map,
            trace_id=trace_id,
        )

        async for event in self.stream_execute(context):
            yield event

    async def run_team_task(
        self,
        node: OrchestrationNode,
        user_message: str,
        history: List[Dict],
        team_context: Dict,
        agents_map: Dict[str, Dict],
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """运行团队任务（非流式）"""
        context = OrchestrationContext(
            node=node,
            user_message=user_message,
            history=history,
            team_context=team_context,
            agents_map=agents_map,
            trace_id=trace_id,
        )

        workflow = self.build_workflow(context)

        # 获取回调
        callbacks = []
        if self.trace_manager and trace_id:
            from .trace import TraceCallbackHandler
            handler = self.trace_manager.get_callback_handler(
                session_id=trace_id,
                agent_id="orchestrator",
            )
            callbacks.append(handler)

        result = await workflow.ainvoke(
            {"message": user_message},
            config=RunnableConfig(callbacks=callbacks) if callbacks else None
        )

        return result

    async def stream_team_task(
        self,
        node: OrchestrationNode,
        user_message: str,
        history: List[Dict],
        team_context: Dict,
        agents_map: Dict[str, Dict],
        trace_id: Optional[str] = None,
    ) -> AsyncIterator[Dict[str, Any]]:
        """流式运行团队任务"""
        context = OrchestrationContext(
            node=node,
            user_message=user_message,
            history=history,
            team_context=team_context,
            agents_map=agents_map,
            trace_id=trace_id,
        )

        async for event in self.stream_execute(context):
            yield event
