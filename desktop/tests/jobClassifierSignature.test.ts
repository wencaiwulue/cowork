import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('job classifier signature', () => {
  it('accepts the job directory and assistant messages passed by stop hooks', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/jobs/classifier.ts'),
      'utf8',
    )

    expect(source).toContain("import type { AssistantMessage } from '../types/message.js'")
    expect(source).toContain(
      'export async function classifyAndWriteState(',
    )
    expect(source).toContain('_jobDir: string,')
    expect(source).toContain('_assistantMessages: AssistantMessage[],')
    expect(source).not.toContain(
      'export async function classifyAndWriteState():',
    )
  })
})
