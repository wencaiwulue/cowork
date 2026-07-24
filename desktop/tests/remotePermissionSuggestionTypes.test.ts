import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('remote permission suggestion types', () => {
  it('parses remote suggestions before assigning them to UI permission decisions', () => {
    const bridge = readFileSync(
      join(process.cwd(), 'src/remote/remotePermissionBridge.ts'),
      'utf8',
    )
    const directConnect = readFileSync(
      join(process.cwd(), 'src/hooks/useDirectConnect.ts'),
      'utf8',
    )
    const remoteSession = readFileSync(
      join(process.cwd(), 'src/hooks/useRemoteSession.ts'),
      'utf8',
    )

    expect(bridge).toContain(
      'export function parseRemotePermissionSuggestions(',
    )
    expect(directConnect).toContain(
      'suggestions: parseRemotePermissionSuggestions(',
    )
    expect(remoteSession).toContain(
      'suggestions: parseRemotePermissionSuggestions(',
    )
    expect(directConnect).not.toContain(
      'suggestions: request.permission_suggestions',
    )
    expect(remoteSession).not.toContain(
      'suggestions: request.permission_suggestions',
    )
  })
})
