import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('computer use MCP server adapter shape', () => {
  it('narrows the local host adapter before calling isDisabled', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/computerUse/mcpServer.ts'),
      'utf8',
    )

    expect(source).toContain('type CliComputerUseHostAdapter =')
    expect(source).toContain(
      'const adapter = getComputerUseHostAdapter() as CliComputerUseHostAdapter',
    )
    expect(source).toContain('isDisabled(): boolean')
  })
})
