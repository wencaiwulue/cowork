import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'

export const TungstenTool = buildTool({
  name: 'Tungsten',
  async description() {
    return 'Unavailable source snapshot tool'
  },
  inputSchema: z.object({}),
  async prompt() {
    return ''
  },
  maxResultSizeChars: 1024,
  isEnabled() {
    return false
  },
  async call() {
    return {
      data: 'TungstenTool is unavailable in this local source snapshot build.',
      resultForAssistant:
        'TungstenTool is unavailable in this local source snapshot build.',
    }
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: String(data),
    }
  },
  renderToolUseMessage() {
    return null
  },
})

export function clearSessionsWithTungstenUsage(): void {}

export function resetInitializationState(): void {}
