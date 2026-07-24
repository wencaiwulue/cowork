import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('null rendering attachments', () => {
  it('includes bagel console attachments that AttachmentMessage renders as null', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/messages/nullRenderingAttachments.ts'),
      'utf8',
    )

    expect(source).toContain("'bagel_console'")
  })
})
