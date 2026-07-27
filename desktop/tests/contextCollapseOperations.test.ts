import { describe, expect, it } from 'vitest'
import { projectView } from '../../src/services/contextCollapse/operations'

describe('context collapse operations stub', () => {
  it('returns the input message view unchanged', () => {
    const messages = [{ type: 'user', message: { content: 'hello' } }]

    expect(projectView(messages)).toBe(messages)
  })
})
