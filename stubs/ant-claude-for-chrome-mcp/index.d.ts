import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export type Logger = {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export type PermissionMode = 'ask' | 'skip_all_permission_checks' | 'follow_a_plan'

export type ClaudeForChromeContext = Record<string, unknown>

export const BROWSER_TOOLS: Tool[]
export function createClaudeForChromeMcpServer(
  context?: ClaudeForChromeContext,
): Server
