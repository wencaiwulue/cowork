import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('skills menu types', () => {
  it('keeps compiled skill groups typed across React compiler cache reads', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/skills/SkillsMenu.tsx'),
      'utf8',
    )

    expect(source).toContain(
      'let groups: Record<SkillSource, SkillCommand[]>;',
    )
    expect(source).toContain(
      'groups = $[3] as Record<SkillSource, SkillCommand[]>;',
    )
  })
})
