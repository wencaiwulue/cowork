import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('log selector tree types', () => {
  it('keeps the compiled tree node array typed for TreeSelect inference', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/LogSelector.tsx'),
      'utf8',
    )

    expect(source).toContain('const treeNodes: LogTreeNode[] = t29')
    expect(source).not.toContain('const treeNodes = t29')
  })
})
