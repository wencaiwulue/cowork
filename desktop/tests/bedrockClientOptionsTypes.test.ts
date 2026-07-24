import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('bedrock client options types', () => {
  it('does not infer bedrock options from the final overloaded constructor signature', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/services/api/client.ts'),
      'utf8',
    )

    expect(source).toContain('type BedrockClientOptions = import(')
    expect(source).toContain('type BedrockStaticCredentialsOptions')
    expect(source).toContain('type BedrockNoStaticCredentialsOptions')
    expect(source).not.toContain(
      'ConstructorParameters<typeof AnthropicBedrock>[0]',
    )
  })
})
