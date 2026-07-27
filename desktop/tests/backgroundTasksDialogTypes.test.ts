import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('background tasks dialog types', () => {
  it('renders remote session details with React.createElement so key is not checked as a prop', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/tasks/BackgroundTasksDialog.tsx'),
      'utf8',
    )

    expect(source).toContain('React.createElement(RemoteSessionDetailDialog')
    expect(source).not.toContain('<RemoteSessionDetailDialog session=')
  })
})
