import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('teammate spinner tree types', () => {
  it('renders teammate lines with React.createElement so key is not checked as a prop', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src/components/Spinner/TeammateSpinnerTree.tsx',
      ),
      'utf8',
    )

    expect(source).toContain('React.createElement(TeammateSpinnerLine')
    expect(source).not.toContain('<TeammateSpinnerLine key={teammate.id}')
  })
})
