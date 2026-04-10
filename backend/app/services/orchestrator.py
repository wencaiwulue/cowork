import asyncio
import json
import re
from typing import List, Dict, Optional
from .agent_runner import run_agent_task
from ..models.schemas import TaskRequest, OrchestrationNode

class OrchestrationService:
    @staticmethod
    async def execute_plan(node: OrchestrationNode, user_message: str, history: List[Dict], team_context: Dict) -> str:
        mode = node.mode.lower()
        print(f"DEBUG: Executing orchestration plan. Mode: {mode}, Agents: {node.agents}")
        
        # Helper to execute either a child node or a raw agent task
        async def run_step(target_node: Optional[OrchestrationNode], agent_id: Optional[str], msg: str) -> str:
            if target_node:
                return await OrchestrationService.execute_plan(target_node, msg, history, team_context)
            if agent_id:
                print(f"DEBUG: Orchestrator running task for agent {agent_id}")
                res = await run_agent_task(agent_id, TaskRequest(message=msg, history=history, team_context=team_context))
                return res["content"]
            return "Error: No execution target"

        if mode == 'supervisor':
            tl_id = team_context.get('tl_id') or (node.agents[0] if node.agents else None)
            if not tl_id: return "No Team Lead found."
            current_query = user_message
            final_answer = ""
            for _ in range(5):
                res = await run_agent_task(tl_id, TaskRequest(message=current_query, history=history, team_context=team_context))
                content = res["content"]
                match = re.search(r'\[DELEGATE:\s*@([^\s\]]+)\]\s*(.+)', content, re.IGNORECASE | re.DOTALL)
                if match:
                    target_name = match.group(1)
                    subtask = match.group(2)
                    target_agent = next((m for m in team_context.get('members', []) if m['name'].lower() == target_name.lower()), None)
                    if target_agent:
                        # Check if this agent has a nested plan (recursive)
                        child_node = next((c for c in (node.children or []) if target_agent['id'] in c.agents), None)
                        sub_res_content = await run_step(child_node, target_agent['id'], subtask)
                        current_query = f"Result from {target_name}: {sub_res_content}\n\nPlease proceed."
                        continue
                final_answer = content
                break
            return final_answer

        elif mode == 'pipeline':
            current_input = user_message
            last_output = ""
            # Pipeline can iterate through agents or children
            steps = node.children if node.children else [{"agent": aid} for aid in node.agents]
            for step in steps:
                if isinstance(step, OrchestrationNode):
                    last_output = await OrchestrationService.execute_plan(step, current_input, history, team_context)
                else:
                    res = await run_agent_task(step["agent"], TaskRequest(message=current_input, history=history, team_context=team_context))
                    last_output = res["content"]
                current_input = f"Previous output: {last_output}\n\nTask: Continue based on this. Goal: {user_message}"
            return last_output

        elif mode == 'parallel':
            tasks = []
            if node.children:
                tasks = [OrchestrationService.execute_plan(c, user_message, history, team_context) for c in node.children]
            else:
                tasks = [run_agent_task(aid, TaskRequest(message=user_message, history=history, team_context=team_context)) for aid in node.agents]
            
            results = await asyncio.gather(*tasks)
            contents = [r if isinstance(r, str) else r["content"] for r in results]
            combined = "\n\n".join([f"--- Result {i+1} ---\n{c}" for i, c in enumerate(contents)])
            summary_res = await run_agent_task(node.agents[0] if node.agents else team_context.get('tl_id'), TaskRequest(
                message=f"Synthesize these parallel results:\n\n{combined}", history=history, team_context=team_context
            ))
            return summary_res["content"]

        elif mode == 'reflection':
            if len(node.agents) < 2: return "Need 2 agents."
            gen_id, rev_id = node.agents[0], node.agents[1]
            max_loops = node.config.get('max_loops', 2) if node.config else 2
            curr_draft, feedback = "", "Initial"
            for _ in range(max_loops):
                gen_res = await run_agent_task(gen_id, TaskRequest(message=f"Task: {user_message}\nFeedback: {feedback}", history=history, team_context=team_context))
                curr_draft = gen_res["content"]
                rev_res = await run_agent_task(rev_id, TaskRequest(message=f"Review this: {curr_draft}. If perfect, say 'APPROVED'.", history=history, team_context=team_context))
                feedback = rev_res["content"]
                if "APPROVED" in feedback.upper(): break
            return curr_draft

        elif mode == 'debate':
            if len(node.agents) < 2: return "Need 2 agents."
            a_id, b_id = node.agents[0], node.agents[1]
            res_a = await run_agent_task(a_id, TaskRequest(message=f"Topic: {user_message}\nYour view?", history=history, team_context=team_context))
            res_b = await run_agent_task(b_id, TaskRequest(message=f"Topic: {user_message}\nAgent A says: {res_a['content']}\nCounter?", history=history, team_context=team_context))
            res_fin = await run_agent_task(a_id, TaskRequest(message=f"Synthesis based on critique: {res_b['content']}", history=history, team_context=team_context))
            return res_fin["content"]

        return "Unknown mode"
