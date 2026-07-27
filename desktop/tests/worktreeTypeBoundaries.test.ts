import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('worktree type boundaries', () => {
  it('uses declared attribution hook and guards create-only baseBranch', () => {
    const worktreeSource = readFileSync(
      join(process.cwd(), 'src/utils/worktree.ts'),
      'utf8',
    )
    const attributionSource = readFileSync(
      join(process.cwd(), 'src/utils/postCommitAttribution.ts'),
      'utf8',
    )

    expect(attributionSource).toContain(
      'export async function installPrepareCommitMsgHook(',
    )
    expect(attributionSource).toContain('_worktreePath: string')
    expect(attributionSource).toContain('_hooksDir?: string')
    expect(worktreeSource).toContain("'baseBranch' in result")
    expect(worktreeSource).toContain("result.baseBranch : 'unknown'")
  })
})
