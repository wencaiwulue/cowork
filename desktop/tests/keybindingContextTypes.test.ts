import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('keybinding context types', () => {
  it('keeps compiled context registration isActive parameter optional', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/keybindings/KeybindingContext.tsx'),
      'utf8',
    )

    expect(source).toContain(
      'export function useRegisterKeybindingContext(context: KeybindingContextName, isActive = true)',
    )
    expect(source).not.toContain(
      'export function useRegisterKeybindingContext(context, t0)',
    )
  })
})
