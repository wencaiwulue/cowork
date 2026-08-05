import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { listCustomCommands } from '../main/customCommands'

describe('desktop custom slash commands', () => {
  it('lists user and project markdown commands with Claude slash names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-commands-'))
    const home = join(root, 'home')
    const cwd = join(root, 'project')
    await mkdir(join(home, 'commands'), { recursive: true })
    await mkdir(join(cwd, '.kode/commands/review'), { recursive: true })
    await writeFile(
      join(home, 'commands/plan.md'),
      '---\ndescription: Plan the next change\n---\n# ignored\n',
    )
    await writeFile(
      join(cwd, '.kode/commands/review/security.md'),
      '# Security review\n\nInspect the current diff.\n',
    )

    await expect(listCustomCommands(cwd, home)).resolves.toEqual([
      {
        name: 'project:review:security',
        scope: 'project',
        path: join(cwd, '.kode/commands/review/security.md'),
        description: 'Security review',
      },
      {
        name: 'user:plan',
        scope: 'user',
        path: join(home, 'commands/plan.md'),
        description: 'Plan the next change',
      },
    ])
  })

  it('lists user and project workflow markdown as slash commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-commands-'))
    const home = join(root, 'home')
    const cwd = join(root, 'project')
    await mkdir(join(home, 'workflows'), { recursive: true })
    await mkdir(join(cwd, '.kode/workflows/review'), { recursive: true })
    await writeFile(
      join(home, 'workflows/triage.md'),
      '---\ndescription: Triage issues\n---\nTriage $ARGUMENTS.\n',
    )
    await writeFile(
      join(cwd, '.kode/workflows/review/security.md'),
      '# Security workflow\n\nReview $target.\n',
    )

    await expect(listCustomCommands(cwd, home)).resolves.toEqual([
      {
        name: 'review:security',
        scope: 'project',
        kind: 'workflow',
        path: join(cwd, '.kode/workflows/review/security.md'),
        description: 'Security workflow',
      },
      {
        name: 'triage',
        scope: 'user',
        kind: 'workflow',
        path: join(home, 'workflows/triage.md'),
        description: 'Triage issues',
      },
    ])
  })

  it('omits user workflows shadowed by a project workflow slash name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-commands-'))
    const home = join(root, 'home')
    const cwd = join(root, 'project')
    await mkdir(join(home, 'workflows'), { recursive: true })
    await mkdir(join(cwd, '.kode/workflows'), { recursive: true })
    await writeFile(join(home, 'workflows/review.md'), '# User review\n')
    await writeFile(join(cwd, '.kode/workflows/review.md'), '# Project review\n')

    await expect(listCustomCommands(cwd, home)).resolves.toEqual([
      {
        name: 'review',
        scope: 'project',
        kind: 'workflow',
        path: join(cwd, '.kode/workflows/review.md'),
        description: 'Project review',
      },
    ])
  })

  it('skips symlinked command entries instead of exposing outside files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-commands-'))
    const home = join(root, 'home')
    const cwd = join(root, 'project')
    const outside = join(root, 'outside')
    await mkdir(join(cwd, '.kode/commands'), { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'secret.md'), '# Secret\n')
    await symlink(join(outside, 'secret.md'), join(cwd, '.kode/commands/secret.md'))

    await expect(listCustomCommands(cwd, home)).resolves.toEqual([])
  })

  it('skips commands with unsafe name segments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-commands-'))
    const home = join(root, 'home')
    const cwd = join(root, 'project')
    await mkdir(join(home, 'commands/group name'), { recursive: true })
    await mkdir(join(cwd, '.kode/commands/review'), { recursive: true })
    await writeFile(join(home, 'commands/group name/ok.md'), '# Unsafe group\n')
    await writeFile(join(home, 'commands/bad:name.md'), '# Unsafe colon\n')
    await writeFile(join(cwd, '.kode/commands/review/bad name.md'), '# Unsafe space\n')
    await writeFile(join(cwd, '.kode/commands/review/bad\tname.md'), '# Unsafe control\n')
    await writeFile(join(cwd, '.kode/commands/review/safe-name_1.md'), '# Safe command\n')

    await expect(listCustomCommands(cwd, home)).resolves.toEqual([
      {
        name: 'project:review:safe-name_1',
        scope: 'project',
        path: join(cwd, '.kode/commands/review/safe-name_1.md'),
        description: 'Safe command',
      },
    ])
  })
})
