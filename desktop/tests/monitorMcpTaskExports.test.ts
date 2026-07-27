import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('monitor MCP task exports', () => {
  it('exports the agent cleanup hook used by AgentTool', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/tasks/MonitorMcpTask/MonitorMcpTask.ts'),
      'utf8',
    )

    expect(source).toContain('export function killMonitorMcpTasksForAgent(')
  })
})
