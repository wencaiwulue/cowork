import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('in-process teammate task helper types', () => {
  it('accepts the full app task state map used by callers', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/tasks/InProcessTeammateTask/InProcessTeammateTask.tsx',
      ),
      'utf8',
    )

    expect(source).toContain("import type { TaskState } from '../types.js'")
    expect(source).toContain('tasks: Record<string, TaskState>')
    expect(source).not.toContain('tasks: Record<string, TaskStateBase>')
  })
})
