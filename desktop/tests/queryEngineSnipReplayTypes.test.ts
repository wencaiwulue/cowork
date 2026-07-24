import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('QueryEngine snip replay types', () => {
  it('adapts snip compact results to the engine replay contract', () => {
    const queryEngine = readFileSync(
      join(process.cwd(), 'src/QueryEngine.ts'),
      'utf8',
    )
    const snipCompact = readFileSync(
      join(process.cwd(), 'src/services/compact/snipCompact.ts'),
      'utf8',
    )

    expect(queryEngine).toContain(
      'const snipResult = snipModule!.snipCompactIfNeeded(store, { force: true })',
    )
    expect(queryEngine).toContain(
      'return { messages: snipResult.messages, executed: snipResult.tokensFreed > 0 }',
    )
    expect(queryEngine).not.toContain(
      'return snipModule!.snipCompactIfNeeded(store, { force: true })',
    )
    expect(snipCompact).toContain('_options?: { force?: boolean }')
  })
})
