import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { TerminalSessionInfo } from './ipc'

type PtyProcess = {
  write(data: string): void
  resize(columns: number, rows: number): void
  kill(): void
  onData(callback: (data: string) => void): void
  onExit(callback: (event: { exitCode: number; signal?: number | string }) => void): void
}

export class TerminalManager extends EventEmitter {
  private terminals = new Map<string, PtyProcess>()
  private infos = new Map<string, TerminalSessionInfo>()

  async create(cwd: string): Promise<TerminalSessionInfo> {
    await assertTerminalCwd(cwd)
    const id = randomUUID()
    const env = Function('return process.env')() as NodeJS.ProcessEnv
    const shell = resolveShell(env)
    const terminalEnv = cleanEnv(env)
    let pty: PtyProcess
    let mode: TerminalSessionInfo['mode'] = 'pty'
    let error: string | undefined
    try {
      const loaded = await loadNodePty()
      ensureSpawnHelperExecutable(loaded.moduleDir)
      pty = loaded.nodePty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 100,
        rows: 28,
        cwd,
        env: terminalEnv,
      })
    } catch (cause) {
      mode = 'shell'
      error = cause instanceof Error ? cause.message : String(cause)
      pty = createShellFallback(shell, cwd, terminalEnv)
    }
    const info: TerminalSessionInfo = { id, mode, shell, columns: 100, rows: 28, error }
    pty.onData(data => {
      if (this.terminals.has(id)) this.emit('data', id, data)
    })
    pty.onExit(event => {
      this.handleExit(
        id,
        event.exitCode ?? null,
        event.signal === undefined ? null : String(event.signal),
      )
    })
    this.terminals.set(id, pty)
    this.infos.set(id, info)
    this.emit('state', info)
    return info
  }

  write(id: string, data: string): void {
    this.requireTerminal(id).write(data)
  }

  resize(id: string, columns: number, rows: number): void {
    const terminal = this.requireTerminal(id)
    terminal.resize(columns, rows)
    const previous = this.infos.get(id)
    if (previous) {
      const next = { ...previous, columns, rows }
      this.infos.set(id, next)
      this.emit('state', next)
    }
  }

  kill(id: string): void {
    this.requireTerminal(id).kill()
    this.terminals.delete(id)
    this.infos.delete(id)
  }

  killAll(): void {
    for (const id of this.terminals.keys()) {
      this.kill(id)
    }
  }

  private handleExit(
    id: string,
    code: number | null,
    signal: string | null,
  ): void {
    if (!this.terminals.has(id)) return
    this.terminals.delete(id)
    this.infos.delete(id)
    this.emit('exit', id, code, signal)
  }

  private requireTerminal(id: string): PtyProcess {
    const terminal = this.terminals.get(id)
    if (!terminal) {
      throw new Error(`Terminal session not found: ${id}`)
    }
    return terminal
  }
}

async function assertTerminalCwd(cwd: string): Promise<void> {
  let stats
  try {
    stats = await stat(cwd)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`Terminal cwd is not accessible: ${cwd}: ${message}`)
  }
  if (!stats.isDirectory()) {
    throw new Error(`Terminal cwd is not a directory: ${cwd}`)
  }
}

type LoadedNodePty = {
  nodePty: typeof import('node-pty')
  moduleDir: string
}

async function loadNodePty(): Promise<LoadedNodePty> {
  const require = createRequire(import.meta.url)
  try {
    return {
      nodePty: await import('node-pty'),
      moduleDir: dirname(require.resolve('node-pty')),
    }
  } catch (cause) {
    const resourcesPath = Function('return process.resourcesPath')() as
      | string
      | undefined
    if (!resourcesPath) throw cause
    const modulePath = join(resourcesPath, 'node_modules/node-pty/lib/index.js')
    return {
      nodePty: require(modulePath),
      moduleDir: dirname(modulePath),
    }
  }
}

function ensureSpawnHelperExecutable(moduleDir: string): void {
  const helper = join(moduleDir, '../prebuilds/darwin-arm64/spawn-helper')
  if (process.platform === 'darwin' && existsSync(helper)) {
    chmodSync(helper, 0o755)
  }
}

function createShellFallback(
  shell: string,
  cwd: string,
  env: Record<string, string>,
): PtyProcess {
  const child = spawn(shell, ['-i'], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const emitter = new EventEmitter()

  child.stdout.on('data', data => emitter.emit('data', data.toString('utf8')))
  child.stderr.on('data', data => emitter.emit('data', data.toString('utf8')))
  child.on('exit', (code, signal) => {
    emitter.emit(
      'data',
      `\n[terminal exited ${code ?? signal ?? 'unknown'}]\n`,
    )
    emitter.emit('exit', {
      exitCode: code ?? 0,
      signal: signal ?? undefined,
    })
  })

  return {
    write(data: string) {
      child.stdin.write(data)
    },
    resize() {},
    kill() {
      child.kill()
    },
    onData(callback: (data: string) => void) {
      emitter.on('data', callback)
    },
    onExit(callback: (event: { exitCode: number; signal?: number | string }) => void) {
      emitter.on('exit', callback)
    },
  }
}

export function resolveShell(env: NodeJS.ProcessEnv): string {
  if (env.SHELL && existsSync(env.SHELL)) return env.SHELL
  if (existsSync('/bin/zsh')) return '/bin/zsh'
  return '/bin/sh'
}

export function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.length > 0) next[key] = value
  }
  if (!next.PATH) {
    next.PATH = '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'
  }
  if (!next.TERM) {
    next.TERM = 'xterm-256color'
  }
  return next
}
