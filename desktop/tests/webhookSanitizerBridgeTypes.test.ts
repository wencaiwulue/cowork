import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('webhook sanitizer bridge types', () => {
  it('exports the inbound webhook content sanitizer used by the REPL bridge', () => {
    const sanitizer = readFileSync(
      join(process.cwd(), 'src/bridge/webhookSanitizer.ts'),
      'utf8',
    )
    const replBridge = readFileSync(
      join(process.cwd(), 'src/hooks/useReplBridge.tsx'),
      'utf8',
    )

    expect(replBridge).toContain('sanitizeInboundWebhookContent')
    expect(sanitizer).toContain('export function sanitizeInboundWebhookContent')
  })
})
