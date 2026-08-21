#!/usr/bin/env node
/**
 * Checks that the CLI's outbound request looks like a generic Anthropic SDK call
 * rather than an identifiable Claude Code one.
 *
 * Stands up a fake Messages API on localhost, points the CLI at it, captures the
 * first POST /v1/messages, and asserts the request shape. Node-only on purpose:
 * bun's runtime cannot execute JS in the Linux dev container, and the compiled
 * macOS binary cannot run there either, so this has to be runnable wherever the
 * binary happens to work.
 *
 *   node scripts/verify-request-shape.mjs [path-to-cli]
 *
 * Exits 0 if every check passes, 1 otherwise. The raw capture is written to
 * /tmp/claude-request-capture.json for inspection either way.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const cliPath = process.argv[2] ?? './dist/claude-local'
const capturePath = join(tmpdir(), 'claude-request-capture.json')
const GENERIC_UA = 'anthropic-sdk-typescript/0.71.0'

const SSE = [
  ['message_start', { type: 'message_start', message: { id: 'msg_verify', type: 'message', role: 'assistant', model: 'claude-opus-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
  ['message_stop', { type: 'message_stop' }],
]

/** Every cache_control object in the request, wherever it hides. */
function collectCacheControls(body) {
  const found = []
  const walk = node => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    if (node.cache_control && typeof node.cache_control === 'object') {
      found.push(node.cache_control)
    }
    Object.values(node).forEach(walk)
  }
  walk(body)
  return found
}

function betaFlags(headers) {
  return (headers['anthropic-beta'] ?? '')
    .split(',')
    .map(flag => flag.trim())
    .filter(Boolean)
}

/**
 * Each check returns null when satisfied, or a string describing what was found.
 * Exported so the self-test can feed it a deliberately dirty request.
 */
export function checkRequest({ headers, body }) {
  const has = name => Object.hasOwn(headers, name)
  const flags = betaFlags(headers)
  const caches = collectCacheControls(body)
  const scoped = caches.filter(cc => 'scope' in cc)

  return [
    ['no x-stainless-* telemetry', () => {
      const found = Object.keys(headers).filter(h => h.startsWith('x-stainless-'))
      return found.length ? `found ${found.join(', ')}` : null
    }],
    ['no x-app', () => (has('x-app') ? `x-app: ${headers['x-app']}` : null)],
    ['no session id header', () =>
      has('x-claude-code-session-id') ? 'x-claude-code-session-id present' : null],
    ['no x-client-app', () => (has('x-client-app') ? 'x-client-app present' : null)],
    ['no x-client-request-id', () =>
      has('x-client-request-id') ? 'x-client-request-id present' : null],
    ['User-Agent is generic', () => {
      const ua = headers['user-agent'] ?? ''
      if (ua.includes('claude-cli')) return `still advertises the CLI: ${ua}`
      return ua === GENERIC_UA ? null : `unexpected UA: ${ua || '(absent)'}`
    }],
    ['no claude-code / cli-internal beta flags', () => {
      const bad = flags.filter(f => /claude-code|cli-internal/i.test(f))
      return bad.length ? `found ${bad.join(', ')}` : null
    }],
    ['no metadata.user_id', () =>
      body?.metadata?.user_id === undefined ? null : 'metadata.user_id present'],
    ['no cache_control.scope', () =>
      scoped.length ? `${scoped.length} of ${caches.length} cache_control carry scope` : null],
    ['thinking is adaptive', () => {
      const thinking = body?.thinking
      if (thinking === undefined) return null // thinking disabled entirely: fine
      if (thinking.type !== 'adaptive') return `thinking.type = ${thinking.type}`
      return 'budget_tokens' in thinking ? 'adaptive but still sends budget_tokens' : null
    }],
    ['output_config.effort is set', () => {
      const effort = body?.output_config?.effort
      return effort === undefined ? 'output_config.effort absent' : null
    }],
  ].map(([label, run]) => ({ label, problem: run() }))
}

function report(results) {
  for (const { label, problem } of results) {
    console.log(`  ${problem ? 'FAIL' : 'pass'}  ${label}${problem ? ` — ${problem}` : ''}`)
  }
  const failed = results.filter(r => r.problem).length
  console.log(
    failed
      ? `\n${failed} of ${results.length} checks failed. Raw capture: ${capturePath}`
      : `\nAll ${results.length} checks passed. Raw capture: ${capturePath}`,
  )
  return failed === 0
}

async function main() {
  let captured = null
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      if (req.method === 'POST' && req.url.includes('/v1/messages')) {
        if (!captured) {
          let body = null
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch {
            body = { __unparseable: Buffer.concat(chunks).toString('utf8').slice(0, 2000) }
          }
          captured = { url: req.url, headers: req.headers, body }
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_verify' })
        for (const [event, data] of SSE) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  console.log(`fake API on 127.0.0.1:${port}`)
  console.log(`running ${cliPath} -p "hi"\n`)

  const child = spawn(cliPath, ['-p', 'hi'], {
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_API_KEY: 'sk-verify-request-shape',
      // Keep the run to the one request we care about.
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', d => (stderr += d))
  const exitCode = await new Promise(resolve => {
    child.on('error', err => {
      console.error(`could not start ${cliPath}: ${err.message}`)
      resolve(null)
    })
    child.on('close', resolve)
  })
  server.close()

  if (!captured) {
    console.error('No POST /v1/messages was captured — nothing to check.')
    console.error(`CLI exit code: ${exitCode}`)
    if (stderr.trim()) console.error(`CLI stderr:\n${stderr.trim().slice(0, 2000)}`)
    process.exit(1)
  }

  writeFileSync(capturePath, JSON.stringify(captured, null, 2))
  console.log('captured request headers:')
  for (const [k, v] of Object.entries(captured.headers).sort()) {
    // Never echo credentials into a log someone will paste into a chat.
    const redacted = /^(authorization|x-api-key)$/i.test(k) ? '<redacted>' : v
    console.log(`  ${k}: ${redacted}`)
  }
  console.log('\nchecks:')
  process.exit(report(checkRequest(captured)) ? 0 : 1)
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
