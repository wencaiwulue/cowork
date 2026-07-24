import { spawn } from 'node:child_process'
import { applyDesktopRuntimeEnv } from './config'
import { resolveCliRuntime } from './sessionHost'

export type CliCommandResult = {
  ok: boolean
  output: string
  error?: string
}

export async function runClaudeCliCommand(
  cwd: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<CliCommandResult> {
  const env = Function('return process.env')() as NodeJS.ProcessEnv
  const runtimeEnv = applyDesktopRuntimeEnv(env)
  const runtime = resolveCliRuntime(import.meta.url, env)
  return new Promise(resolve => {
    const child = spawn(runtime.command, [...runtime.prefixArgs, ...args], {
      cwd,
      env: {
        ...runtimeEnv,
        CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
      },
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      resolve({
        ok: false,
        output: `${stdout}${stderr}`.trim(),
        error: `Claude command timed out: ${args.join(' ')}`,
      })
    }, timeoutMs)

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', cause => {
      clearTimeout(timeout)
      resolve({
        ok: false,
        output: `${stdout}${stderr}`.trim(),
        error: cause instanceof Error ? cause.message : String(cause),
      })
    })
    child.on('exit', code => {
      clearTimeout(timeout)
      resolve({
        ok: code === 0,
        output: `${stdout}${stderr}`.trim(),
        ...(code === 0 ? {} : { error: `claude ${args.join(' ')} exited with code ${code}` }),
      })
    })
  })
}
