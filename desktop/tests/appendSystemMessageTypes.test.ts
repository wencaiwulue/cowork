import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('append system message types', () => {
  it('accepts system messages without collapsing through an any-based Exclude', () => {
    const toolSource = readFileSync(join(process.cwd(), 'src/Tool.ts'), 'utf8')
    const extractSource = readFileSync(
      join(process.cwd(), 'src/services/extractMemories/extractMemories.ts'),
      'utf8',
    )

    expect(toolSource).toContain('appendSystemMessage?: (msg: SystemMessage) => void')
    expect(extractSource).toContain(
      'type AppendSystemMessageFn = (msg: SystemMessage) => void',
    )
    expect(toolSource).not.toContain(
      'Exclude<SystemMessage, SystemLocalCommandMessage>',
    )
    expect(extractSource).not.toContain(
      'Exclude<SystemMessage, SystemLocalCommandMessage>',
    )
  })
})
