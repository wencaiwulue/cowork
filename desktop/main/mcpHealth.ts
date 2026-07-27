import type { McpHealthResult } from './ipc'
import { runClaudeCliCommand } from './cliCommand'

export async function checkMcpHealth(cwd: string): Promise<McpHealthResult> {
  const result = await runClaudeCliCommand(cwd, ['mcp', 'list'], 15_000)
  return {
    ...result,
    error: result.error?.replace(/^claude mcp list/, 'mcp list'),
  }
}
