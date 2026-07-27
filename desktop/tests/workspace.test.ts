import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  MAX_EDITABLE_FILE_BYTES,
  readWorkspaceFile,
  readWorkspaceTree,
  saveWorkspaceFile,
} from '../main/workspace'

async function tempWorkspace(): Promise<string> {
  const root = join(tmpdir(), `claude-desktop-${randomUUID()}`)
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1\n')
  await mkdir(join(root, 'node_modules'), { recursive: true })
  await writeFile(join(root, 'node_modules', 'ignored.js'), '')
  return root
}

describe('workspace file APIs', () => {
  it('reads, saves, and lists files inside the workspace', async () => {
    const root = await tempWorkspace()

    const tree = await readWorkspaceTree(root)
    expect(tree.map(entry => entry.name)).toContain('src')
    expect(tree.find(entry => entry.name === 'src')?.path).toBe('src')
    expect(tree.map(entry => entry.name)).not.toContain('node_modules')
    expect(await readWorkspaceFile(root, 'src/app.ts')).toBe(
      'export const value = 1\n',
    )

    await saveWorkspaceFile(root, 'src/app.ts', 'export const value = 2\n')

    expect(await readFile(join(root, 'src', 'app.ts'), 'utf8')).toBe(
      'export const value = 2\n',
    )
  })

  it('rejects reads and writes outside the workspace root', async () => {
    const root = await tempWorkspace()

    await expect(readWorkspaceFile(root, '../outside.txt')).rejects.toThrow(
      'Path is outside the workspace',
    )
    await expect(
      saveWorkspaceFile(root, '../outside.txt', 'nope'),
    ).rejects.toThrow('Path is outside the workspace')
  })

  it('rejects absolute file paths even when they point inside the workspace', async () => {
    const root = await tempWorkspace()
    const absolutePath = join(root, 'src', 'app.ts')

    await expect(readWorkspaceFile(root, absolutePath)).rejects.toThrow(
      'Workspace file path must be relative',
    )
    await expect(
      saveWorkspaceFile(root, absolutePath, 'export const value = 3\n'),
    ).rejects.toThrow('Workspace file path must be relative')
  })

  it('rejects binary files in the desktop editor', async () => {
    const root = await tempWorkspace()
    await writeFile(join(root, 'src', 'image.bin'), Buffer.from([0x89, 0x00, 0x50]))

    await expect(readWorkspaceFile(root, 'src/image.bin')).rejects.toThrow(
      'Binary files cannot be opened in the desktop editor',
    )
  })

  it('rejects files larger than the desktop editor limit', async () => {
    const root = await tempWorkspace()
    await writeFile(
      join(root, 'src', 'large.txt'),
      `${'x'.repeat(MAX_EDITABLE_FILE_BYTES)}x`,
    )

    await expect(readWorkspaceFile(root, 'src/large.txt')).rejects.toThrow(
      'File is too large to open in the desktop editor',
    )
    await expect(
      saveWorkspaceFile(root, 'src/app.ts', `${'x'.repeat(MAX_EDITABLE_FILE_BYTES)}x`),
    ).rejects.toThrow('File is too large to save from the desktop editor')
  })

  it('rejects symlink reads and writes that escape the workspace root', async () => {
    const root = await tempWorkspace()
    const outside = join(tmpdir(), `claude-desktop-outside-${randomUUID()}`)
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'secret.txt'), 'secret\n')
    await symlink(join(outside, 'secret.txt'), join(root, 'src', 'secret-link.txt'))
    await symlink(outside, join(root, 'src', 'outside-dir'))

    await expect(readWorkspaceFile(root, 'src/secret-link.txt')).rejects.toThrow(
      'Path is outside the workspace',
    )
    await expect(
      saveWorkspaceFile(root, 'src/secret-link.txt', 'overwrite\n'),
    ).rejects.toThrow('Path is outside the workspace')
    await expect(
      saveWorkspaceFile(root, 'src/outside-dir/new.txt', 'new\n'),
    ).rejects.toThrow('Path is outside the workspace')
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('secret\n')
  })

  it('does not traverse symlinked directories in the file tree', async () => {
    const root = await tempWorkspace()
    const outside = join(tmpdir(), `claude-desktop-outside-${randomUUID()}`)
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'secret.txt'), 'secret\n')
    await symlink(outside, join(root, 'src', 'outside-dir'))

    const tree = await readWorkspaceTree(root)
    const src = tree.find(entry => entry.name === 'src')

    expect(src?.children?.map(entry => entry.name)).not.toContain('outside-dir')
    expect(JSON.stringify(tree)).not.toContain('secret.txt')
  })
})
