import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const repoRoot = resolve(new URL('../..', import.meta.url).pathname)
const cli = join(repoRoot, 'dist/claude-local')
const cwd = await mkdtemp(join(tmpdir(), 'claude-desktop-smoke-'))
const sessionId = randomUUID()

async function runTurn(content, turnIndex) {
  const sessionArgs =
    turnIndex === 0 ? ['--session-id', sessionId] : ['--resume', sessionId]
  const child = spawn(
    cli,
    [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--replay-user-messages',
      '--verbose',
      ...sessionArgs,
    ],
    { cwd, stdio: ['pipe', 'pipe', 'pipe'] },
  )

  let buffer = ''
  let stderr = ''
  const assistantTexts = []
  let resultCount = 0
  let finished = false

  const finish = resolve => {
    if (finished) return
    finished = true
    child.kill('SIGTERM')
    resolve()
  }

  const done = new Promise(resolve => {
    const timeout = setTimeout(() => finish(resolve), 45_000)

    child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        let message
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }

        if (message.type === 'assistant') {
          const parts = message.message?.content
          if (Array.isArray(parts)) {
            for (const part of parts) {
              if (part.type === 'text') assistantTexts.push(part.text)
            }
          }
        }

        if (message.type === 'result') {
          resultCount += 1
          clearTimeout(timeout)
          child.kill('SIGTERM')
        }
      }
    })

    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })

    child.on('exit', () => {
      clearTimeout(timeout)
      finish(resolve)
    })
  })

  child.stdin.write(
    `${JSON.stringify({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: sessionId,
    })}\n`,
  )

  await done
  return {
    assistantTexts,
    resultCount,
    stderr: stderr.trim().slice(-1000),
  }
}

const first = await runTurn('Reply only: one', 0)
const second = await runTurn('Reply only: two', 1)
const assistantTexts = [...first.assistantTexts, ...second.assistantTexts]
const resultCount = first.resultCount + second.resultCount
const stderr = [first.stderr, second.stderr].filter(Boolean).join('\n')

const ok =
  resultCount >= 2 &&
  assistantTexts.some(text => text.trim() === 'one') &&
  assistantTexts.some(text => text.trim() === 'two')

console.log(
  JSON.stringify(
    {
      ok,
      cwd,
      sessionId,
      resultCount,
      assistantTexts,
      stderr,
    },
    null,
    2,
  ),
)

if (!ok) process.exit(1)
