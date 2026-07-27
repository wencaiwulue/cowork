import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('agent tool usage shape', () => {
  it('includes required beta usage detail fields for synthetic assistant messages', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/tools/AgentTool/UI.tsx'),
      'utf8',
    )

    expect(source).toContain('output_tokens_details: null')
    expect(source).toContain('cache_creation: null')
    expect(source).toContain('cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0')
    expect(source).toContain('cache_read_input_tokens: usage.cache_read_input_tokens ?? 0')
    expect(source).toContain('server_tool_use: usage.server_tool_use ?? null')
    expect(source).toContain('service_tier: usage.service_tier ?? null')
  })
})
