import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createSessionHost,
  resolveCliEntrypoint,
  resolveCliRuntime,
} from '../main/sessionHost'

class FakeProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdin = {
    writes: [] as string[],
    write: (value: string) => {
      this.stdin.writes.push(value)
      return true
    },
  }
  killed = false

  kill() {
    this.killed = true
    this.emit('exit', 0)
    return true
  }
}

describe('createSessionHost', () => {
  it('resolves the source CLI entrypoint from desktop source or dist locations', () => {
    const sourcePath = resolveCliEntrypoint(
      'file:///Users/fengcaiwen/test/claude-code/desktop/main/sessionHost.ts',
    )
    const distPath = resolveCliEntrypoint(
      'file:///Users/fengcaiwen/test/claude-code/desktop/dist/main/main.js',
    )

    expect(sourcePath).toBe(distPath)
    expect(sourcePath.endsWith('src/entrypoints/cli.tsx')).toBe(true)
    expect(existsSync(resolveCliEntrypoint(import.meta.url))).toBe(true)
  })

  it('prefers the compiled CLI runtime when available', () => {
    const root = join(tmpdir(), `claude-desktop-runtime-${randomUUID()}`)
    mkdirSync(join(root, 'dist'), { recursive: true })
    mkdirSync(join(root, 'desktop/dist/main'), { recursive: true })
    writeFileSync(join(root, 'dist/claude-local'), '')
    const runtime = resolveCliRuntime(
      `file://${join(root, 'desktop/dist/main/main.js')}`,
      {},
    )

    expect(runtime.command).toBe(join(root, 'dist/claude-local'))
    expect(runtime.prefixArgs).toEqual([])
  })

  it('prefers the packaged resources CLI runtime when available', () => {
    const root = join(tmpdir(), `claude-desktop-packaged-runtime-${randomUUID()}`)
    mkdirSync(join(root, 'Resources/dist'), { recursive: true })
    mkdirSync(join(root, 'app.asar/desktop/dist/main'), { recursive: true })
    writeFileSync(join(root, 'Resources/dist/claude-local'), '')
    const runtime = resolveCliRuntime(
      `file://${join(root, 'app.asar/desktop/dist/main/main.js')}`,
      { CLAUDE_CODE_DESKTOP_RESOURCES_PATH: join(root, 'Resources') },
    )

    expect(runtime.command).toBe(join(root, 'Resources/dist/claude-local'))
    expect(runtime.prefixArgs).toEqual([])
  })

  it('writes user messages, permission responses, and interrupts as stream-json lines', () => {
    const child = new FakeProcess()
    const host = createSessionHost({
      sessionId: 'session-1',
      cwd: '/tmp/project',
      child: child as never,
    })

    host.sendMessage('hello')
    host.respondToPermission('request-1', {
      behavior: 'allow',
      updatedInput: { command: 'git status' },
    })
    host.cancel()

    const writes = child.stdin.writes.map(line => JSON.parse(line))
    expect(writes.slice(0, 2)).toEqual([
      {
        type: 'user',
        message: { role: 'user', content: 'hello' },
        parent_tool_use_id: null,
        session_id: 'session-1',
      },
      {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'request-1',
          response: {
            behavior: 'allow',
            updatedInput: { command: 'git status' },
          },
        },
      },
    ])
    expect(writes[2]).toEqual({
      type: 'control_request',
      request_id: expect.any(String),
      request: { subtype: 'interrupt' },
    })
  })

  it('emits parsed runtime messages from child stdout', () => {
    const child = new FakeProcess()
    const host = createSessionHost({
      sessionId: 'session-1',
      cwd: '/tmp/project',
      child: child as never,
    })
    const messages: unknown[] = []
    host.on('message', message => messages.push(message))

    child.stdout.emit('data', Buffer.from('{"type":"assistant"}\n'))

    expect(messages).toEqual([{ type: 'assistant' }])
  })

  it('rotates the one-shot CLI child before sending the next completed turn', () => {
    const first = new FakeProcess()
    const second = new FakeProcess()
    const childQueue = [first, second]
    const exits: unknown[] = []
    const host = createSessionHost({
      sessionId: 'session-1',
      cwd: '/tmp/project',
      spawnChild: () => childQueue.shift() as never,
    })
    host.on('exit', (code, signal) => exits.push({ code, signal }))

    host.sendMessage('one')
    first.stdout.emit('data', Buffer.from('{"type":"result"}\n'))
    host.sendMessage('two')

    expect(first.killed).toBe(true)
    expect(JSON.parse(first.stdin.writes[0]).message.content).toBe('one')
    expect(JSON.parse(second.stdin.writes[0]).message.content).toBe('two')
    expect(childQueue).toHaveLength(0)
    expect(exits).toEqual([])
  })

  it('passes agent session options to the first CLI child only', () => {
    const first = new FakeProcess()
    const second = new FakeProcess()
    const childQueue = [first, second]
    const spawnedArgs: string[][] = []
    const host = createSessionHost({
      sessionId: 'session-1',
      cwd: '/tmp/project',
      agent: {
        agentType: 'reviewer',
        model: 'sonnet',
        permissionMode: 'plan',
        isolation: 'worktree',
      },
      spawnChild: args => {
        spawnedArgs.push(args)
        return childQueue.shift() as never
      },
    })

    host.sendMessage('one')
    first.stdout.emit('data', Buffer.from('{"type":"result"}\n'))
    host.sendMessage('two')

    expect(spawnedArgs[0]).toEqual(expect.arrayContaining([
      '--session-id',
      'session-1',
      '--agent',
      'reviewer',
      '--model',
      'sonnet',
      '--permission-mode',
      'plan',
      '--worktree',
    ]))
    expect(spawnedArgs[1]).toEqual(expect.arrayContaining([
      '--resume',
      'session-1',
    ]))
    expect(spawnedArgs[1]).not.toContain('--agent')
    expect(spawnedArgs[1]).not.toContain('--worktree')
  })

  it('passes saved desktop proxy settings into spawned runtime env', () => {
    const storeDir = mkdtempSync(join(tmpdir(), 'desktop-session-host-store-'))
    const storePath = join(storeDir, 'sessions.json')
    const child = new FakeProcess()
    let spawnedEnv: NodeJS.ProcessEnv | undefined
    const previousStorePath = process.env.CLAUDE_CODE_DESKTOP_STORE_PATH
    try {
      writeFileSync(storePath, JSON.stringify({
        sessions: [],
        config: {
          proxy: {
            enabled: true,
            url: 'socks5://127.0.0.1:18999',
          },
        },
      }))
      process.env.CLAUDE_CODE_DESKTOP_STORE_PATH = storePath
      createSessionHost({
        sessionId: 'session-1',
        cwd: '/tmp/project',
        spawnChild: (_args, options) => {
          spawnedEnv = options.env
          return child as never
        },
      })
      expect(spawnedEnv).toMatchObject({
        ALL_PROXY: 'socks5://127.0.0.1:18999',
        HTTPS_PROXY: 'socks5://127.0.0.1:18999',
        CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
      })
    } finally {
      if (previousStorePath === undefined) {
        delete process.env.CLAUDE_CODE_DESKTOP_STORE_PATH
      } else {
        process.env.CLAUDE_CODE_DESKTOP_STORE_PATH = previousStorePath
      }
      rmSync(storeDir, { recursive: true, force: true })
    }
  })

  it('reports child spawn errors as stderr and a single failed exit', () => {
    const child = new FakeProcess()
    const host = createSessionHost({
      sessionId: 'session-1',
      cwd: '/tmp/project',
      child: child as never,
    })
    const stderr: string[] = []
    const exits: unknown[] = []
    host.on('stderr', message => stderr.push(message))
    host.on('exit', (code, signal) => exits.push({ code, signal }))

    child.emit('error', new Error('spawn failed'))
    child.emit('exit', 1, null)

    expect(stderr).toEqual(['spawn failed'])
    expect(exits).toEqual([{ code: 1, signal: null }])
  })
})
