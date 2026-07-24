import { expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  BROWSER_TOOLS,
  createClaudeForChromeMcpServer,
} from '../stubs/ant-claude-for-chrome-mcp/index.js'
import {
  buildComputerUseTools,
  createComputerUseMcpServer,
} from '../stubs/ant-computer-use-mcp/index.js'

class InProcessTransport {
  peer
  closed = false
  onclose
  onerror
  onmessage

  setPeer(peer) {
    this.peer = peer
  }

  async start() {}

  async send(message) {
    if (this.closed) throw new Error('Transport is closed')
    queueMicrotask(() => this.peer?.onmessage?.(message))
  }

  async close() {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
    if (this.peer && !this.peer.closed) {
      this.peer.closed = true
      this.peer.onclose?.()
    }
  }
}

function createLinkedTransportPair() {
  const a = new InProcessTransport()
  const b = new InProcessTransport()
  a.setPeer(b)
  b.setPeer(a)
  return [a, b]
}

async function connect(server) {
  const client = new Client({ name: 'test-client', version: '0.1.0' })
  const [clientTransport, serverTransport] = createLinkedTransportPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

test('Chrome MCP lists local browser automation tools', async () => {
  const names = BROWSER_TOOLS.map(tool => tool.name)
  expect(names).toContain('tabs_context_mcp')
  expect(names).toContain('tabs_create_mcp')
  expect(names).toContain('navigate')
  expect(names).toContain('read_page')
  expect(names).toContain('computer')

  const client = await connect(createClaudeForChromeMcpServer())
  const listed = await client.listTools()
  expect(listed.tools.map(tool => tool.name)).toContain('javascript_tool')
  await client.close()
})

test('Chrome MCP can automate a data URL when Playwright Chromium is available', async () => {
  const client = await connect(createClaudeForChromeMcpServer())
  const url =
    'data:text/html,' +
    encodeURIComponent(
      '<!doctype html><title>Local MCP</title><h1>Hello browser</h1><script>console.log("local-console")</script>',
    )

  const created = await client.callTool({
    name: 'tabs_create_mcp',
    arguments: { url },
  })
  if (created.isError) {
    expect(created.content[0].text).toMatch(/browser|chromium|playwright/i)
    await client.close()
    return
  }

  const text = await client.callTool({ name: 'get_page_text', arguments: {} })
  expect(text.content[0].text).toContain('Hello browser')

  const js = await client.callTool({
    name: 'javascript_tool',
    arguments: { text: 'document.title' },
  })
  expect(js.content[0].text).toContain('Local MCP')

  const logs = await client.callTool({
    name: 'read_console_messages',
    arguments: { pattern: 'local-console' },
  })
  expect(logs.content[0].text).toContain('local-console')
  await client.close()
})

test('Computer Use MCP lists v1 tools and returns explicit unsupported errors', async () => {
  const names = buildComputerUseTools().map(tool => tool.name)
  expect(names).toContain('screenshot')
  expect(names).toContain('cursor_position')
  expect(names).toContain('mouse_move')
  expect(names).toContain('left_click')
  expect(names).toContain('type')
  expect(names).toContain('computer_batch')

  const client = await connect(createComputerUseMcpServer())
  const listed = await client.listTools()
  expect(listed.tools.map(tool => tool.name)).toContain('write_clipboard')

  const unsupported = await client.callTool({
    name: 'request_access',
    arguments: {},
  })
  expect(unsupported.isError).toBe(true)
  expect(unsupported.content[0].text).toContain(
    'not available in the local open-source Computer Use implementation',
  )
  await client.close()
})
