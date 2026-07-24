/**
 * Grouped suggestion providers for @ and / composer triggers.
 *
 * Returns categorized suggestion groups matching ChatGPT Desktop's composer menu:
 * - For @: Teammates, Agents, Files, MCP Resources, Skills
 * - For /: Recent, Commands, Skills & Workflows, Other
 *
 * Design doc: docs/design/composer-redesign-arch.md
 */

import type { Command } from '../../types/command.js'
import type { SettingSource } from '../../utils/settings/constants.js'
import { getCommandName } from '../../commands.js'
import type { SuggestionItem } from '../../components/PromptInput/PromptInputFooterSuggestions.js'
import { generateFileSuggestions } from '../../hooks/fileSuggestions.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import type { ServerResource } from '../../services/mcp/types.js'
import { getAgentColor } from '../../tools/AgentTool/agentColorManager.js'
import { getSkillUsageScore } from './skillUsageTracking.js'
import { truncateToWidth } from '../format.js'
import type { Theme } from '../theme.js'

export type SuggestionGroup = {
  id: string
  label: string
  items: SuggestionItem[]
  priority: number
}

export type GroupedSuggestionsResult = {
  groups: SuggestionGroup[]
  /** Flat list of all items (for keyboard navigation indexing) */
  allItems: SuggestionItem[]
}

type TeammateInfo = {
  name: string
  color?: string
  status?: string
}

type SkillInfo = {
  name: string
  description?: string
  source: string
}

const MAX_ITEMS_PER_GROUP = 6
const MAX_TOTAL_ITEMS = 20
const DESC_MAX_WIDTH = 50

function fuzzyMatch(query: string, ...texts: (string | undefined)[]): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return texts.some(t => t?.toLowerCase().includes(q))
}

function truncateDesc(text: string): string {
  return truncateToWidth(text.replace(/\s+/g, ' '), DESC_MAX_WIDTH)
}

/**
 * Generate grouped suggestions for an @ trigger.
 *
 * Categories (in order):
 * 0. Teammates — active team members (swarm mode)
 * 1. Agents — available subagent types
 * 2. Files — workspace file paths (from Rust/nucleo index)
 * 3. MCP Resources — MCP server resources
 * 4. Skills — prompt-type commands as @skill:name
 */
export async function generateAtSuggestions(
  query: string,
  agents: AgentDefinition[],
  mcpResources: Record<string, ServerResource[]>,
  teammates: TeammateInfo[],
  skills: SkillInfo[],
  showOnEmpty: boolean,
): Promise<GroupedSuggestionsResult> {
  const groups: SuggestionGroup[] = []

  // --- Teammates ---
  const teammateItems: SuggestionItem[] = teammates
    .filter(t => fuzzyMatch(query, t.name))
    .slice(0, MAX_ITEMS_PER_GROUP)
    .map(t => ({
      id: `teammate-${t.name}`,
      displayText: t.name,
      description: t.status ? `send message · ${t.status}` : 'send message',
      color: t.color as keyof Theme | undefined,
      metadata: { type: 'teammate', name: t.name },
    }))
  if (teammateItems.length > 0) {
    groups.push({ id: 'teammates', label: 'Teammates', items: teammateItems, priority: 0 })
  }

  // --- Agents ---
  const agentItems: SuggestionItem[] = agents
    .filter(a => fuzzyMatch(query, a.agentType, a.whenToUse))
    .slice(0, MAX_ITEMS_PER_GROUP)
    .map(agent => ({
      id: `agent-${agent.agentType}`,
      displayText: agent.agentType,
      description: truncateDesc(agent.whenToUse),
      color: getAgentColor(agent.agentType),
      metadata: { type: 'agent', agentType: agent.agentType },
    }))
  if (agentItems.length > 0) {
    groups.push({ id: 'agents', label: 'Agents', items: agentItems, priority: 1 })
  }

  // --- Files ---
  try {
    const fileSuggestions = await generateFileSuggestions(query, showOnEmpty)
    const fileItems: SuggestionItem[] = fileSuggestions
      .slice(0, MAX_ITEMS_PER_GROUP)
      .map(f => {
        const filePath = f.displayText
        const fileName = filePath.split('/').pop() ?? filePath
        const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : ''
        return {
          id: f.id,
          displayText: filePath,
          description: dir || fileName,
          metadata: { ...(f.metadata as Record<string, unknown>), type: 'file' },
        }
      })
    if (fileItems.length > 0) {
      groups.push({ id: 'files', label: 'Files', items: fileItems, priority: 2 })
    }
  } catch {
    // File index may not be ready yet
  }

  // --- MCP Resources ---
  const mcpItems: SuggestionItem[] = []
  for (const [server, resources] of Object.entries(mcpResources)) {
    for (const resource of resources) {
      const label = `${server}:${resource.uri}`
      const desc = resource.description || resource.name || resource.uri
      if (fuzzyMatch(query, label, desc)) {
        mcpItems.push({
          id: `mcp-resource-${server}__${resource.uri}`,
          displayText: label,
          description: truncateDesc(desc),
          metadata: { type: 'mcp_resource', server, uri: resource.uri },
        })
      }
    }
  }
  if (mcpItems.length > 0) {
    groups.push({ id: 'mcp', label: 'MCP Resources', items: mcpItems.slice(0, MAX_ITEMS_PER_GROUP), priority: 3 })
  }

  // --- Skills ---
  const skillItems: SuggestionItem[] = skills
    .filter(s => fuzzyMatch(query, s.name, s.description))
    .sort((a, b) => {
      const scoreA = getSkillUsageScore(a.name)
      const scoreB = getSkillUsageScore(b.name)
      if (scoreA !== scoreB) return scoreB - scoreA
      return a.name.localeCompare(b.name)
    })
    .slice(0, MAX_ITEMS_PER_GROUP)
    .map(skill => ({
      id: `skill-${skill.source}-${skill.name}`,
      displayText: `skill:${skill.name}`,
      description: truncateDesc(skill.description ?? `Skill · ${skill.source}`),
      metadata: { type: 'skill', name: skill.name },
    }))
  if (skillItems.length > 0) {
    groups.push({ id: 'skills', label: 'Skills', items: skillItems, priority: 4 })
  }

  groups.sort((a, b) => a.priority - b.priority)
  const allItems = flattenWithGroups(groups).slice(0, MAX_TOTAL_ITEMS + groups.length)

  return { groups, allItems }
}

/**
 * Generate grouped suggestions for a / trigger (slash commands at start of input).
 *
 * Categories (in order):
 * 0. Recent — most frequently used prompt commands/skills
 * 1. Commands — built-in local and local-jsx commands
 * 2. Skills & Workflows — user/project prompt commands
 * 3. Other — any remaining command types
 */
export function generateSlashSuggestions(
  query: string,
  commands: Command[],
): GroupedSuggestionsResult {
  const groups: SuggestionGroup[] = []
  const q = query.toLowerCase().trim()

  const visibleCommands = commands.filter(cmd => !cmd.isHidden)
  const matches = (cmd: Command): boolean => {
    if (!q) return true
    const name = getCommandName(cmd).toLowerCase()
    const desc = (cmd.description ?? '').toLowerCase()
    return name.includes(q) || desc.includes(q)
  }

  // --- Recently used (prompt commands with usage score) ---
  const recentlyUsed: Command[] = []
  if (q === '') {
    const scored = visibleCommands
      .filter(cmd => cmd.type === 'prompt')
      .map(cmd => ({ cmd, score: getSkillUsageScore(getCommandName(cmd)) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
    for (const item of scored.slice(0, 5)) {
      recentlyUsed.push(item.cmd)
    }
  }
  const recentNames = new Set(recentlyUsed.map(c => getCommandName(c)))

  // Categorize remaining commands
  const builtinCommands: Command[] = []
  const skillCommands: Command[] = []
  const otherCommands: Command[] = []

  for (const cmd of visibleCommands) {
    if (recentNames.has(getCommandName(cmd))) continue
    if (!matches(cmd)) continue

    if (cmd.type === 'local' || cmd.type === 'local-jsx') {
      builtinCommands.push(cmd)
    } else if (cmd.type === 'prompt') {
      skillCommands.push(cmd)
    } else {
      otherCommands.push(cmd)
    }
  }

  const sortAlpha = (a: Command, b: Command) =>
    getCommandName(a).localeCompare(getCommandName(b))

  builtinCommands.sort(sortAlpha)
  skillCommands.sort((a, b) => {
    const scoreA = getSkillUsageScore(getCommandName(a))
    const scoreB = getSkillUsageScore(getCommandName(b))
    if (scoreA !== scoreB) return scoreB - scoreA
    return sortAlpha(a, b)
  })
  otherCommands.sort(sortAlpha)

  function toItem(cmd: Command): SuggestionItem {
    const name = getCommandName(cmd)
    const isWorkflow = cmd.type === 'prompt' && cmd.kind === 'workflow'
    const argHint = cmd.type === 'prompt' && cmd.argNames?.length
      ? ` (args: ${cmd.argNames.join(', ')})`
      : ''
    const tag = isWorkflow ? 'workflow' : cmd.type === 'prompt' ? (cmd.source as SettingSource | undefined) : undefined
    return {
      id: `${name}:${cmd.type}`,
      displayText: `/${name}`,
      tag,
      description: `${cmd.description ?? ''}${argHint}`,
      metadata: cmd,
    }
  }

  if (recentlyUsed.length > 0) {
    groups.push({ id: 'recent', label: 'Recent', items: recentlyUsed.map(toItem), priority: 0 })
  }
  if (builtinCommands.length > 0) {
    groups.push({ id: 'builtin', label: 'Commands', items: builtinCommands.slice(0, 8).map(toItem), priority: 1 })
  }
  if (skillCommands.length > 0) {
    groups.push({ id: 'skills', label: 'Skills & Workflows', items: skillCommands.slice(0, 8).map(toItem), priority: 2 })
  }
  if (otherCommands.length > 0) {
    groups.push({ id: 'other', label: 'Other', items: otherCommands.slice(0, 5).map(toItem), priority: 3 })
  }

  groups.sort((a, b) => a.priority - b.priority)
  const allItems = flattenWithGroups(groups).slice(0, MAX_TOTAL_ITEMS + groups.length)

  return { groups, allItems }
}

/**
 * Flatten groups into a flat array with group header items interspersed.
 * Group headers have IDs prefixed with "__group__" and are non-selectable.
 */
function flattenWithGroups(groups: SuggestionGroup[]): SuggestionItem[] {
  const flat: SuggestionItem[] = []
  for (const group of groups) {
    if (group.items.length === 0) continue
    flat.push({
      id: `__group__${group.id}`,
      displayText: group.label,
      groupLabel: group.label,
    })
    flat.push(...group.items)
  }
  return flat
}
