import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { createNdjsonParser } from './ndjson'
import { applyDesktopRuntimeEnv } from './config'
import type { DesktopAttachment, PermissionResponse } from './ipc'

export type SessionHostChild = Pick<
  ChildProcessWithoutNullStreams,
  'stdin' | 'stdout' | 'stderr' | 'kill' | 'on'
>

export type SessionHostOptions = {
  sessionId: string
  cwd: string
  agent?: {
    agentType?: string
    model?: string
    permissionMode?: string
    isolation?: 'worktree' | 'remote'
  }
  child?: SessionHostChild
  spawnChild?: (
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ) => SessionHostChild
}

export type SessionHost = EventEmitter & {
  readonly sessionId: string
  readonly cwd: string
  sendMessage(text: string, attachments?: DesktopAttachment[]): void
  answerQuestion(toolUseId: string, answers: Record<string, string>, questions: Array<{question: string; options: Array<{label: string; description: string}>}>): void
  respondToPermission(requestId: string, response: PermissionResponse): void
  cancel(): void
  close(): void
  on(event: 'message', listener: (message: unknown) => void): SessionHost
  on(event: 'malformed', listener: (line: string) => void): SessionHost
  on(event: 'stderr', listener: (message: string) => void): SessionHost
  on(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): SessionHost
}

function writeJsonLine(child: SessionHostChild, value: unknown): void {
  child.stdin.write(`${JSON.stringify(value)}\n`)
}

export function resolveCliEntrypoint(
  metaUrl = import.meta.url,
  env = Function('return process.env')() as NodeJS.ProcessEnv,
): string {
  if (env.CLAUDE_CODE_DESKTOP_CLI_ENTRYPOINT) {
    return env.CLAUDE_CODE_DESKTOP_CLI_ENTRYPOINT
  }

  let current = dirname(fileURLToPath(metaUrl))
  while (true) {
    const candidate = join(current, 'src/entrypoints/cli.tsx')
    if (existsSync(candidate)) {
      return candidate
    }
    const next = dirname(current)
    if (next === current) {
      return candidate
    }
    current = next
  }
}

export function resolveCliRuntime(
  metaUrl = import.meta.url,
  env = Function('return process.env')() as NodeJS.ProcessEnv,
): { command: string; prefixArgs: string[] } {
  if (env.CLAUDE_CODE_DESKTOP_CLI_COMMAND) {
    return { command: env.CLAUDE_CODE_DESKTOP_CLI_COMMAND, prefixArgs: [] }
  }

  if (env.CLAUDE_CODE_DESKTOP_CLI_ENTRYPOINT) {
    return {
      command: env.BUN_EXECUTABLE || 'bun',
      prefixArgs: [env.CLAUDE_CODE_DESKTOP_CLI_ENTRYPOINT],
    }
  }

  const resourcesPath =
    env.CLAUDE_CODE_DESKTOP_RESOURCES_PATH ||
    (Function('return process.resourcesPath')() as string | undefined)
  if (resourcesPath) {
    const packagedBinary = join(resourcesPath, 'dist/claude-local')
    if (existsSync(packagedBinary)) {
      return { command: packagedBinary, prefixArgs: [] }
    }
  }

  let current = dirname(fileURLToPath(metaUrl))
  while (true) {
    const binary = join(current, 'dist/claude-local')
    if (existsSync(binary)) {
      return { command: binary, prefixArgs: [] }
    }
    const next = dirname(current)
    if (next === current) break
    current = next
  }

  return {
    command: env.BUN_EXECUTABLE || 'bun',
    prefixArgs: [resolveCliEntrypoint(metaUrl, env)],
  }
}

export function createSessionHost(options: SessionHostOptions): SessionHost {
  const env = Function('return process.env')() as NodeJS.ProcessEnv
  const runtimeEnv = applyDesktopRuntimeEnv(env)
  const runtime = resolveCliRuntime(import.meta.url, env)
  let spawnedRuntimeCount = 0
  const spawnRuntimeChild = () => {
    const sessionArgs =
      spawnedRuntimeCount === 0
        ? ['--session-id', options.sessionId]
        : ['--resume', options.sessionId]
    const agentArgs =
      spawnedRuntimeCount === 0 && options.agent
        ? buildAgentArgs(options.agent)
        : []
    const args = [
        ...runtime.prefixArgs,
        '-p',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--replay-user-messages',
        '--verbose',
        ...sessionArgs,
        ...agentArgs,
      ]
    spawnedRuntimeCount += 1
    const spawnOptions = {
      cwd: options.cwd,
      env: {
        ...runtimeEnv,
        CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
      },
    }
    if (options.spawnChild) return options.spawnChild(args, spawnOptions)
    return spawn(
      runtime.command,
      args,
      spawnOptions,
    )
  }
  let child = options.child ?? spawnRuntimeChild()

  const host = new EventEmitter() as SessionHost
  Object.defineProperties(host, {
    sessionId: { value: options.sessionId, enumerable: true },
    cwd: { value: options.cwd, enumerable: true },
  })

  let exited = false
  let closed = false
  let turnCompleted = false
  const emitExit = (code: number | null, signal: NodeJS.Signals | null) => {
    if (exited) return
    exited = true
    host.emit('exit', code, signal)
  }

  const attachChild = (attachedChild: SessionHostChild) => {
    const stdoutParser = createNdjsonParser(
      message => {
        if (
          message &&
          typeof message === 'object' &&
          'type' in message &&
          (message as { type?: unknown }).type === 'result'
        ) {
          turnCompleted = true
        }
        host.emit('message', message)
      },
      line => host.emit('malformed', line),
    )

    attachedChild.stdout.on('data', chunk => stdoutParser.push(chunk))
    attachedChild.stderr.on('data', chunk => host.emit('stderr', chunk.toString()))
    attachedChild.on('error', cause => {
      if (attachedChild !== child || closed) return
      host.emit('stderr', cause instanceof Error ? cause.message : String(cause))
      stdoutParser.flush()
      emitExit(1, null)
    })
    attachedChild.on('exit', (code, signal) => {
      if (attachedChild !== child || closed) return
      stdoutParser.flush()
      emitExit(code, signal)
    })
  }

  const rotateChildForNextTurn = () => {
    if (options.child || !turnCompleted) return
    const previousChild = child
    turnCompleted = false
    child = spawnRuntimeChild()
    attachChild(child)
    previousChild.kill()
  }

  attachChild(child)

  host.sendMessage = (text: string, attachments?: DesktopAttachment[]) => {
    rotateChildForNextTurn()
    let content: unknown = text
    if (attachments?.length) {
      const blocks: unknown[] = []
      if (text) {
        blocks.push({ type: 'text', text })
      }
      for (const att of attachments) {
        const b64Data = att.dataUrl.split(',')[1] ?? ''
        if (att.mimeType.startsWith('image/')) {
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: att.mimeType,
              data: b64Data,
            },
          })
        } else if (att.mimeType === 'application/pdf') {
          blocks.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: b64Data,
            },
          })
        } else if (att.mimeType.startsWith('text/')) {
          const text = Buffer.from(b64Data, 'base64').toString('utf-8')
          blocks.push({
            type: 'text',
            text: `File: ${att.filename}\n\n\`\`\`\n${text}\n\`\`\``,
          })
        }
      }
      if (blocks.length) content = blocks
    }
    writeJsonLine(child, {
      type: 'user',
      message: {
        role: 'user',
        content,
      },
      parent_tool_use_id: null,
      session_id: options.sessionId,
    })
  }

  host.respondToPermission = (
    requestId: string,
    response: PermissionResponse,
  ) => {
    writeJsonLine(child, {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response,
      },
    })
  }

  host.answerQuestion = (
    toolUseId: string,
    answers: Record<string, string>,
    questions: Array<{question: string; options: Array<{label: string; description: string}>}>,
  ) => {
    const toolResultContent = JSON.stringify({ questions, answers })
    writeJsonLine(child, {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: toolResultContent,
          },
        ],
      },
      parent_tool_use_id: null,
      session_id: options.sessionId,
    })
  }

  host.cancel = () => {
    writeJsonLine(child, {
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'interrupt' },
    })
  }

  host.close = () => {
    closed = true
    child.kill()
  }

  return host
}

function buildAgentArgs(agent: NonNullable<SessionHostOptions['agent']>): string[] {
  const args: string[] = []
  if (agent.agentType) args.push('--agent', agent.agentType)
  if (agent.model) args.push('--model', agent.model)
  if (agent.permissionMode) args.push('--permission-mode', agent.permissionMode)
  if (agent.isolation === 'worktree') args.push('--worktree')
  return args
}
