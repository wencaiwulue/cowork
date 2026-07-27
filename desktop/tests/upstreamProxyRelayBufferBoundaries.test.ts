import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('upstream proxy relay buffer boundaries', () => {
  it('normalizes runtime socket data at Bun and Node write boundaries', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/upstreamproxy/relay.ts'),
      'utf8',
    )

    expect(source).toContain(
      'handleData(adapter, st, Buffer.from(data), wsUrl, authHeader, wsAuthHeader)',
    )
    expect(source).not.toContain(
      'handleData(adapter, st, data, wsUrl, authHeader, wsAuthHeader)',
    )
    expect(source).toContain("if (typeof payload === 'string')")
    expect(source).toContain("sock.write(payload, 'utf8')")
  })
})
