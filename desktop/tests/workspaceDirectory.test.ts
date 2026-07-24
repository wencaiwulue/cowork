import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertWorkspaceDirectory,
  assertWorkspaceFileTarget,
} from '../main/workspaceDirectory'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

describe('workspace directory validation', () => {
  it('accepts existing directories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'claude-desktop-workspace-'))
    tempDirs.push(dir)

    await expect(assertWorkspaceDirectory(dir)).resolves.toBe(dir)
  })

  it('rejects missing paths and files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'claude-desktop-workspace-'))
    tempDirs.push(dir)
    const file = join(dir, 'not-a-directory.txt')
    await writeFile(file, 'contents', 'utf8')

    await expect(assertWorkspaceDirectory(join(dir, 'missing'))).rejects.toThrow(
      'Workspace folder does not exist:',
    )
    await expect(assertWorkspaceDirectory(file)).rejects.toThrow(
      'Workspace path is not a folder:',
    )
  })

  it('rejects symlinked workspace directories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'claude-desktop-workspace-'))
    const linkParent = await mkdtemp(join(tmpdir(), 'claude-desktop-workspace-link-'))
    tempDirs.push(dir, linkParent)
    const link = join(linkParent, 'project-link')
    await symlink(dir, link)

    await expect(assertWorkspaceDirectory(link)).rejects.toThrow(
      'Workspace folder must not be a symlink:',
    )
  })

  it('accepts existing and new file targets inside the workspace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'claude-desktop-workspace-'))
    tempDirs.push(dir)
    const existing = join(dir, 'settings.json')
    await writeFile(existing, '{}', 'utf8')

    await expect(assertWorkspaceFileTarget(dir, existing)).resolves.toBe(existing)
    await expect(
      assertWorkspaceFileTarget(dir, join(dir, 'new.json'), { forWrite: true }),
    ).resolves.toBe(join(dir, 'new.json'))
  })

  it('rejects file targets outside the workspace or through symlinks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'claude-desktop-workspace-'))
    const outside = await mkdtemp(join(tmpdir(), 'claude-desktop-outside-'))
    tempDirs.push(dir, outside)
    const outsideFile = join(outside, 'settings.json')
    await writeFile(outsideFile, '{}', 'utf8')
    await symlink(outsideFile, join(dir, 'settings-link.json'))
    await symlink(outside, join(dir, 'outside-dir'))

    await expect(assertWorkspaceFileTarget(dir, join(outside, 'settings.json'))).rejects.toThrow(
      'Workspace file target is outside the workspace',
    )
    await expect(assertWorkspaceFileTarget(dir, join(dir, 'settings-link.json'))).rejects.toThrow(
      'Workspace file target must not be a symlink:',
    )
    await expect(
      assertWorkspaceFileTarget(dir, join(dir, 'outside-dir', 'new.json'), { forWrite: true }),
    ).rejects.toThrow('Workspace file target is outside the workspace')

    await mkdir(join(dir, 'nested'), { recursive: true })
    await expect(
      assertWorkspaceFileTarget(dir, join(dir, 'nested', 'new.json'), { forWrite: true }),
    ).resolves.toBe(join(dir, 'nested', 'new.json'))
  })
})
