import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('tree select types', () => {
  it('keeps compiled traverse parent id parameter optional', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/ui/TreeSelect.tsx'),
      'utf8',
    )

    expect(source).toContain(
      'export function TreeSelect<T>(t0: TreeSelectProps<T>)',
    )
    expect(source).toContain(
      'function traverse(node: TreeNode<T>, depth: number, parentId?: string | number)',
    )
    expect(source).not.toContain('export function TreeSelect(t0)')
    expect(source).not.toContain('function traverse(node, depth, parentId)')
  })
})
