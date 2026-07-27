import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('dialog launchers resume chooser types', () => {
  it('passes a complete typed props object to ResumeConversation', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/dialogLaunchers.tsx'),
      'utf8',
    )

    expect(source).toContain(
      'const resumeConversationProps: ResumeConversationProps = {',
    )
    expect(source).toContain('<ResumeConversation {...resumeConversationProps} />')
    expect(source).not.toContain(
      '<ResumeConversation {...resumeProps} worktreePaths={worktreePaths} />',
    )
  })
})
