import { describe, expect, it } from 'vitest'
import { shouldSubmitComposerKey } from '../renderer/src/composerKeys.ts'

describe('composer keyboard behavior', () => {
  it('submits on plain Enter and keeps Shift+Enter for newlines', () => {
    expect(shouldSubmitComposerKey({ key: 'Enter' })).toBe(true)
    expect(shouldSubmitComposerKey({ key: 'Enter', shiftKey: true })).toBe(false)
  })

  it('does not submit during IME composition or unrelated keys', () => {
    expect(shouldSubmitComposerKey({ key: 'Enter', isComposing: true })).toBe(false)
    expect(shouldSubmitComposerKey({ key: 'Enter', keyCode: 229 })).toBe(false)
    expect(shouldSubmitComposerKey({ key: 'a' })).toBe(false)
  })
})
