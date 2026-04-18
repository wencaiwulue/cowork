import asyncio
import json
import re
from typing import List, Dict, Optional, AsyncIterator
from .agent_runner import run_agent_task, stream_agent_task
from ..models.schemas import TaskRequest, OrchestrationNode


class OrchestrationService:

    @staticmethod
    async def execute_plan(
        node: OrchestrationNode,
        user_message: str,
        history: List[Dict],
        team_context: Dict,
    ) -> str:
        """Synchronous (non-streaming) team execution. Used internally for sub-steps."""
        mode = node.mode.lower()
        print(f"DEBUG: Orchestration plan — mode={mode}, agents={node.agents}")

        async def run_step(
            target_node: Optional[OrchestrationNode],
            agent_id: Optional[str],
            msg: str,
        ) -> str:
            if target_node:
                return await OrchestrationService.execute_plan(target_node, msg, history, team_context)
            if agent_id:
                res = await run_agent_task(agent_id, TaskRequest(message=msg, history=history, team_context=team_context))
                return res["content"]
            return "Error: No execution target"

        if mode == "supervisor":
            tl_id = team_context.get("tl_id") or (node.agents[0] if node.agents else None)
            if not tl_id:
                return "No Team Lead found."
            current_query = user_message
            final_answer = ""
            for _ in range(5):
                res = await run_agent_task(tl_id, TaskRequest(message=current_query, history=history, team_context=team_context))
                content = res["content"]
                match = re.search(r"\[DELEGATE:\s*@([^\s\]]+)\]\s*(.+)", content, re.IGNORECASE | re.DOTALL)
                if match:
                    target_name = match.group(1)
                    subtask = match.group(2)
                    target_agent = next(
                        (m for m in team_context.get("members", []) if m["name"].lower() == target_name.lower()),
                        None,
                    )
                    if target_agent:
                        child_node = next(
                            (c for c in (node.children or []) if target_agent["id"] in c.agents),
                            None,
                        )
                        sub_result = await run_step(child_node, target_agent["id"], subtask)
                        current_query = f"Result from {target_name}: {sub_result}\n\nPlease proceed."
                        continue
                final_answer = content
                break
            return final_answer

        elif mode == "pipeline":
            current_input = user_message
            last_output = ""
            steps = node.children if node.children else [{"agent": aid} for aid in node.agents]
            for step in steps:
                if isinstance(step, OrchestrationNode):
                    last_output = await OrchestrationService.execute_plan(step, current_input, history, team_context)
                else:
                    res = await run_agent_task(step["agent"], TaskRequest(message=current_input, history=history, team_context=team_context))
                    last_output = res["content"]
                current_input = f"Previous output: {last_output}\n\nTask: Continue. Goal: {user_message}"
            return last_output

        elif mode == "parallel":
            if node.children:
                tasks = [OrchestrationService.execute_plan(c, user_message, history, team_context) for c in node.children]
            else:
                tasks = [
                    run_agent_task(aid, TaskRequest(message=user_message, history=history, team_context=team_context))
                    for aid in node.agents
                ]
            results = await asyncio.gather(*tasks)
            contents = [r if isinstance(r, str) else r["content"] for r in results]
            combined = "\n\n".join(f"--- Result {i+1} ---\n{c}" for i, c in enumerate(contents))
            summary_id = node.agents[0] if node.agents else team_context.get("tl_id")
            summary_res = await run_agent_task(
                summary_id,
                TaskRequest(message=f"Synthesize these parallel results:\n\n{combined}", history=history, team_context=team_context),
            )
            return summary_res["content"]

        elif mode == "reflection":
            if len(node.agents) < 2:
                return "Need 2 agents."
            gen_id, rev_id = node.agents[0], node.agents[1]
            max_loops = (node.config or {}).get("max_loops", 2)
            curr_draft, feedback = "", "Initial"
            for _ in range(max_loops):
                gen_res = await run_agent_task(gen_id, TaskRequest(message=f"Task: {user_message}\nFeedback: {feedback}", history=history, team_context=team_context))
                curr_draft = gen_res["content"]
                rev_res = await run_agent_task(rev_id, TaskRequest(message=f"Review this: {curr_draft}. If perfect, say 'APPROVED'.", history=history, team_context=team_context))
                feedback = rev_res["content"]
                if "APPROVED" in feedback.upper():
                    break
            return curr_draft

        elif mode == "debate":
            if len(node.agents) < 2:
                return "Need 2 agents."
            a_id, b_id = node.agents[0], node.agents[1]
            res_a = await run_agent_task(a_id, TaskRequest(message=f"Topic: {user_message}\nYour view?", history=history, team_context=team_context))
            res_b = await run_agent_task(b_id, TaskRequest(message=f"Topic: {user_message}\nAgent A says: {res_a['content']}\nCounter?", history=history, team_context=team_context))
            res_fin = await run_agent_task(a_id, TaskRequest(message=f"Synthesis based on critique: {res_b['content']}", history=history, team_context=team_context))
            return res_fin["content"]

        return "Unknown mode"

    # ─── SSE streaming variant ────────────────────────────────────────────────

    @staticmethod
    async def stream_plan(
        node: OrchestrationNode,
        user_message: str,
        history: List[Dict],
        team_context: Dict,
        agents_map: Dict[str, Dict],  # id -> {name, avatar}
    ) -> AsyncIterator[str]:
        """
        Stream team orchestration. Emits SSE events:
          {"agent": name, "agent_id": id, "content": chunk, "reasoning": chunk}
          {"agent": name, "agent_id": id, "done": true}
          {"orchestration_done": true, "final": "..."}

        For supervisor/pipeline/reflection/debate: runs sub-agents one at a time,
        streaming each. For parallel: runs concurrently, interleaves chunks.
        """
        mode = node.mode.lower()

        def agent_name(aid: str) -> str:
            return agents_map.get(aid, {}).get("name", aid)

        async def stream_one(agent_id: str, msg: str) -> AsyncIterator[str]:
            """Stream a single agent, yielding SSE lines."""
            name = agent_name(agent_id)
            request = TaskRequest(message=msg, history=history, team_context=team_context)
            async for sse_line in stream_agent_task(agent_id, request):
                if not sse_line.startswith("data: "):
                    continue
                payload = sse_line[6:].strip()
                if payload == "[DONE]":
                    yield json.dumps({"agent": name, "agent_id": agent_id, "done": True})
                    break
                try:
                    data = json.loads(payload)
                    if "todos" in data:
                        yield json.dumps({"todos": data["todos"], "agent_id": agent_id})
                        continue
                    if "error" in data:
                        yield json.dumps({"agent": name, "agent_id": agent_id, "error": data["error"]})
                        break
                    chunk = data.get("content", "")
                    reasoning = data.get("reasoning", "")
                    yield json.dumps({"agent": name, "agent_id": agent_id, "content": chunk, "reasoning": reasoning})
                except Exception:
                    pass

        # ── supervisor mode ──────────────────────────────────────────────────
        if mode == "supervisor":
            tl_id = team_context.get("tl_id") or (node.agents[0] if node.agents else None)
            if not tl_id:
                yield json.dumps({"error": "No Team Lead"})
                return
            current_query = user_message
            for _ in range(5):
                tl_content = ""
                async for event_json in stream_one(tl_id, current_query):
                    data = json.loads(event_json)
                    if "content" in data:
                        tl_content += data.get("content", "")
                    yield f"data: {event_json}\n\n"

                match = re.search(r"\[DELEGATE:\s*@([^\s\]]+)\]\s*(.+)", tl_content, re.IGNORECASE | re.DOTALL)
                if match:
                    target_name = match.group(1)
                    subtask = match.group(2)
                    target = next(
                        (m for m in team_context.get("members", []) if m["name"].lower() == target_name.lower()),
                        None,
                    )
                    if target:
                        sub_content = ""
                        async for event_json in stream_one(target["id"], subtask):
                            data = json.loads(event_json)
                            if "content" in data:
                                sub_content += data.get("content", "")
                            yield f"data: {event_json}\n\n"
                        current_query = f"Result from {target_name}: {sub_content}\n\nPlease proceed."
                        continue
                yield f"data: {json.dumps({'orchestration_done': True, 'final': tl_content})}\n\n"
                return
            yield f"data: {json.dumps({'orchestration_done': True, 'final': tl_content})}\n\n"

        # ── pipeline mode ────────────────────────────────────────────────────
        elif mode == "pipeline":
            current_input = user_message
            last_output = ""
            for agent_id in node.agents:
                last_output = ""
                async for event_json in stream_one(agent_id, current_input):
                    data = json.loads(event_json)
                    if "content" in data:
                        last_output += data.get("content", "")
                    yield f"data: {event_json}\n\n"
                current_input = f"Previous output: {last_output}\n\nTask: Continue. Goal: {user_message}"
            yield f"data: {json.dumps({'orchestration_done': True, 'final': last_output})}\n\n"

        # ── parallel mode ────────────────────────────────────────────────────
        elif mode == "parallel":
            # Collect all agent streams into a single queue
            queue: asyncio.Queue = asyncio.Queue()
            collected_per_agent: Dict[str, str] = {aid: "" for aid in node.agents}

            async def feed(agent_id: str):
                async for event_json in stream_one(agent_id, user_message):
                    await queue.put((agent_id, event_json))
                await queue.put((agent_id, None))  # sentinel

            done_count = 0
            tasks = [asyncio.create_task(feed(aid)) for aid in node.agents]
            total = len(node.agents)

            while done_count < total:
                agent_id, event_json = await queue.get()
                if event_json is None:
                    done_count += 1
                    continue
                data = json.loads(event_json)
                if "content" in data:
                    collected_per_agent[agent_id] = collected_per_agent.get(agent_id, "") + data.get("content", "")
                yield f"data: {event_json}\n\n"

            # Synthesize
            combined = "\n\n".join(
                f"--- {agent_name(aid)} ---\n{content}"
                for aid, content in collected_per_agent.items()
            )
            synth_id = node.agents[0] if node.agents else team_context.get("tl_id")
            synth_content = ""
            async for event_json in stream_one(synth_id, f"Synthesize these results:\n\n{combined}"):
                data = json.loads(event_json)
                if "content" in data:
                    synth_content += data.get("content", "")
                yield f"data: {event_json}\n\n"

            yield f"data: {json.dumps({'orchestration_done': True, 'final': synth_content})}\n\n"

        # ── reflection mode ──────────────────────────────────────────────────
        elif mode == "reflection":
            if len(node.agents) < 2:
                yield f"data: {json.dumps({'error': 'Need 2 agents'})}\n\n"
                return
            gen_id, rev_id = node.agents[0], node.agents[1]
            max_loops = (node.config or {}).get("max_loops", 2)
            feedback = "Initial"
            curr_draft = ""
            for _ in range(max_loops):
                curr_draft = ""
                async for event_json in stream_one(gen_id, f"Task: {user_message}\nFeedback: {feedback}"):
                    data = json.loads(event_json)
                    if "content" in data:
                        curr_draft += data.get("content", "")
                    yield f"data: {event_json}\n\n"
                feedback = ""
                async for event_json in stream_one(rev_id, f"Review: {curr_draft}. If perfect say 'APPROVED'."):
                    data = json.loads(event_json)
                    if "content" in data:
                        feedback += data.get("content", "")
                    yield f"data: {event_json}\n\n"
                if "APPROVED" in feedback.upper():
                    break
            yield f"data: {json.dumps({'orchestration_done': True, 'final': curr_draft})}\n\n"

        # ── debate mode ──────────────────────────────────────────────────────
        elif mode == "debate":
            if len(node.agents) < 2:
                yield f"data: {json.dumps({'error': 'Need 2 agents'})}\n\n"
                return
            a_id, b_id = node.agents[0], node.agents[1]
            a_content = ""
            async for event_json in stream_one(a_id, f"Topic: {user_message}\nYour view?"):
                data = json.loads(event_json)
                if "content" in data:
                    a_content += data.get("content", "")
                yield f"data: {event_json}\n\n"
            b_content = ""
            async for event_json in stream_one(b_id, f"Topic: {user_message}\nAgent A says: {a_content}\nCounter?"):
                data = json.loads(event_json)
                if "content" in data:
                    b_content += data.get("content", "")
                yield f"data: {event_json}\n\n"
            final_content = ""
            async for event_json in stream_one(a_id, f"Synthesis based on critique: {b_content}"):
                data = json.loads(event_json)
                if "content" in data:
                    final_content += data.get("content", "")
                yield f"data: {event_json}\n\n"
            yield f"data: {json.dumps({'orchestration_done': True, 'final': final_content})}\n\n"

        else:
            yield f"data: {json.dumps({'error': f'Unknown mode: {mode}'})}\n\n"
