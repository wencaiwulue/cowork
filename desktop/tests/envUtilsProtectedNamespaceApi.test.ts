import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('envUtils protected namespace API', () => {
  it('calls the protectedNamespace export that exists in this snapshot', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/utils/envUtils.ts'),
      'utf8',
    )

    expect(source).toContain(').isInProtectedNamespace()')
    expect(source).not.toContain(').checkProtectedNamespace()')
  })
})
