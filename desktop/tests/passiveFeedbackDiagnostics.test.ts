import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('passive feedback diagnostics', () => {
  it('formats protocol diagnostic messages through a string helper', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/services/lsp/passiveFeedback.ts'),
      'utf8',
    )

    expect(source).toContain('Diagnostic,')
    expect(source).toContain('function formatDiagnosticMessage(')
    expect(source).toContain('message: formatDiagnosticMessage(diag.message)')
    expect(source).not.toContain('message: diag.message')
  })
})
