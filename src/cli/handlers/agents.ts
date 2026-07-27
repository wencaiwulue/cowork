/**
 * Agents subcommand handler — prints the list of configured agents.
 * Dynamically imported only when `claude agents` runs.
 */

import {
  AGENT_SOURCE_GROUPS,
  compareAgentsByName,
  getOverrideSourceLabel,
  type ResolvedAgent,
  resolveAgentModelDisplay,
  resolveAgentOverrides,
} from '../../tools/AgentTool/agentDisplay.js'
import {
  getActiveAgentsFromList,
  getAgentDefinitionsWithOverrides,
  type AgentDefinition,
} from '../../tools/AgentTool/loadAgentsDir.js'
import { getCwd } from '../../utils/cwd.js'

export type AgentsHandlerOptions = {
  json?: boolean
}

export type SerializedAgent = {
  agentType: string
  source: ResolvedAgent['source']
  sourceLabel: string
  whenToUse: string
  active: boolean
  overriddenBy?: ResolvedAgent['overriddenBy']
  tools?: string[]
  disallowedTools?: string[]
  skills?: string[]
  requiredMcpServers?: string[]
  mcpServers?: Array<Record<string, unknown>>
  model?: string
  effort?: string | number
  permissionMode?: string
  maxTurns?: number
  memory?: string
  isolation?: 'worktree' | 'remote'
  background?: boolean
  hasHooks?: boolean
  baseDir?: string
  filename?: string
  plugin?: string
}

export type SerializedAgentsResult = {
  activeAgents: SerializedAgent[]
  allAgents: SerializedAgent[]
  failedFiles?: Array<{ path: string; error: string }>
}

function formatAgent(agent: ResolvedAgent): string {
  const model = resolveAgentModelDisplay(agent)
  const parts = [agent.agentType]
  if (model) {
    parts.push(model)
  }
  if (agent.memory) {
    parts.push(`${agent.memory} memory`)
  }
  return parts.join(' · ')
}

function compareSerializedAgents(
  a: Pick<SerializedAgent, 'agentType'>,
  b: Pick<SerializedAgent, 'agentType'>,
): number {
  return a.agentType.localeCompare(b.agentType, undefined, {
    sensitivity: 'base',
  })
}

function sourceLabelForAgent(agent: ResolvedAgent): string {
  const group = AGENT_SOURCE_GROUPS.find(item => item.source === agent.source)
  return group?.label ?? String(agent.source)
}

function serializeAgent(
  agent: ResolvedAgent,
  activeAgentTypes: Set<string>,
): SerializedAgent {
  return pruneUndefined({
    agentType: agent.agentType,
    source: agent.source,
    sourceLabel: sourceLabelForAgent(agent),
    whenToUse: agent.whenToUse,
    active: activeAgentTypes.has(agent.agentType) && !agent.overriddenBy,
    overriddenBy: agent.overriddenBy,
    tools: agent.tools,
    disallowedTools: agent.disallowedTools,
    skills: agent.skills,
    requiredMcpServers: agent.requiredMcpServers,
    mcpServers: agent.mcpServers?.map(server => ({ ...(server as object) })),
    model: resolveAgentModelDisplay(agent),
    effort: agent.effort,
    permissionMode: agent.permissionMode,
    maxTurns: agent.maxTurns,
    memory: agent.memory,
    isolation: agent.isolation,
    background: agent.background,
    hasHooks: agent.hooks !== undefined,
    baseDir: agent.baseDir,
    filename: agent.filename,
    plugin: isPluginAgent(agent) ? agent.plugin : undefined,
  })
}

function isPluginAgent(
  agent: AgentDefinition,
): agent is AgentDefinition & { source: 'plugin'; plugin: string } {
  return agent.source === 'plugin'
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key]
    }
  }
  return value
}

export async function getSerializedAgents(): Promise<SerializedAgentsResult> {
  const cwd = getCwd()
  const { allAgents, failedFiles } = await getAgentDefinitionsWithOverrides(cwd)
  const activeAgents = getActiveAgentsFromList(allAgents)
  const resolvedAgents = resolveAgentOverrides(allAgents, activeAgents)
  const activeAgentTypes = new Set(activeAgents.map(agent => agent.agentType))

  return pruneUndefined({
    activeAgents: activeAgents
      .map(agent => serializeAgent(agent, activeAgentTypes))
      .sort(compareSerializedAgents),
    allAgents: resolvedAgents
      .map(agent => serializeAgent(agent, activeAgentTypes))
      .sort(compareSerializedAgents),
    failedFiles,
  })
}

export async function agentsHandler(
  options: AgentsHandlerOptions = {},
): Promise<void> {
  const serialized = await getSerializedAgents()
  if (options.json) {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(JSON.stringify(serialized, null, 2))
    return
  }

  const resolvedAgents = serialized.allAgents

  const lines: string[] = []
  let totalActive = 0

  for (const { label, source } of AGENT_SOURCE_GROUPS) {
    const groupAgents = resolvedAgents
      .filter(a => a.source === source)
      .sort(compareSerializedAgents)

    if (groupAgents.length === 0) continue

    lines.push(`${label}:`)
    for (const agent of groupAgents) {
      if (agent.overriddenBy) {
        const winnerSource = getOverrideSourceLabel(agent.overriddenBy)
        lines.push(`  (shadowed by ${winnerSource}) ${formatAgent(agent as any)}`)
      } else {
        lines.push(`  ${formatAgent(agent as any)}`)
        totalActive++
      }
    }
    lines.push('')
  }

  if (lines.length === 0) {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log('No agents found.')
  } else {
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(`${totalActive} active agents\n`)
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    console.log(lines.join('\n').trimEnd())
  }
}
