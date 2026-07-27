import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanEnv, resolveShell, TerminalManager } from '../main/terminal'

const fakePty = new EventEmitter() as EventEmitter & {
  writes: string[]
  resizes: Array<[number, number]>
  killed: boolean
  write(data: string): void
  resize(columns: number, rows: number): void
  kill(): void
  onData(callback: (data: string) => void): void
  onExit(callback: (event: { exitCode: number; signal?: string }) => void): void
}

fakePty.writes = []
fakePty.resizes = []
fakePty.killed = false
fakePty.write = (data: string) => {
  fakePty.writes.push(data)
}
fakePty.resize = (columns: number, rows: number) => {
  fakePty.resizes.push([columns, rows])
}
fakePty.kill = () => {
  fakePty.killed = true
}
fakePty.onData = callback => {
  fakePty.on('data', callback)
}
fakePty.onExit = callback => {
  fakePty.on('exit', callback)
}

const spawn = vi.fn(() => fakePty)

vi.mock('node-pty', () => ({
  spawn,
}))

describe('TerminalManager', () => {
  beforeEach(() => {
    fakePty.removeAllListeners()
    fakePty.writes = []
    fakePty.resizes = []
    fakePty.killed = false
    spawn.mockClear()
  })

  it('creates, writes, resizes, emits output, and kills PTYs', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'terminal-project-'))
    const terminalManager = new TerminalManager()
    const output: string[] = []
    const states: unknown[] = []
    terminalManager.on('data', (_terminalId, data) => output.push(data))
    terminalManager.on('state', state => states.push(state))

    try {
      const terminal = await terminalManager.create(cwd)
      terminalManager.write(terminal.id, 'pwd\n')
      terminalManager.resize(terminal.id, 120, 32)
      fakePty.emit('data', `${cwd}\n`)
      terminalManager.kill(terminal.id)

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        [],
        expect.objectContaining({
          cols: 100,
          rows: 28,
          cwd,
        }),
      )
      expect(terminal).toMatchObject({ mode: 'pty', columns: 100, rows: 28 })
      expect(states).toEqual([
        terminal,
        { ...terminal, columns: 120, rows: 32 },
      ])
      expect(fakePty.writes).toEqual(['pwd\n'])
      expect(fakePty.resizes).toEqual([[120, 32]])
      expect(output).toEqual([`${cwd}\n`])
      expect(fakePty.killed).toBe(true)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('emits terminal exits and removes dead terminals', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'terminal-exit-'))
    const terminalManager = new TerminalManager()
    const exits: unknown[] = []
    terminalManager.on('exit', (id, code, signal) => exits.push({ id, code, signal }))

    try {
      const terminal = await terminalManager.create(cwd)
      fakePty.emit('exit', { exitCode: 7 })
      expect(() => terminalManager.write(terminal.id, 'after-exit\n')).toThrow(
        `Terminal session not found: ${terminal.id}`,
      )

      expect(exits).toEqual([{ id: terminal.id, code: 7, signal: null }])
      expect(fakePty.writes).toEqual([])
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('rejects writes, resizes, and kills for missing terminals', () => {
    const terminalManager = new TerminalManager()

    expect(() => terminalManager.write('missing-terminal', 'pwd\n')).toThrow(
      'Terminal session not found: missing-terminal',
    )
    expect(() => terminalManager.resize('missing-terminal', 120, 32)).toThrow(
      'Terminal session not found: missing-terminal',
    )
    expect(() => terminalManager.kill('missing-terminal')).toThrow(
      'Terminal session not found: missing-terminal',
    )
  })

  it('rejects terminal creation when cwd is not a directory', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'terminal-file-cwd-'))
    const filePath = join(cwd, 'not-a-directory')
    await writeFile(filePath, 'not a directory\n')
    try {
      const terminalManager = new TerminalManager()
      await expect(terminalManager.create(filePath)).rejects.toThrow(
        'Terminal cwd is not a directory',
      )
      expect(spawn).not.toHaveBeenCalled()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('normalizes terminal environment and shell fallback', () => {
    expect(resolveShell({ SHELL: '/does/not/exist' })).toMatch(/^\/bin\//)
    expect(cleanEnv({ A: '1', B: undefined, PATH: '' })).toMatchObject({
      A: '1',
      TERM: 'xterm-256color',
    })
    expect('B' in cleanEnv({ B: undefined })).toBe(false)
  })
})
