import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const MAX_TEXT_CHARS = 120_000
const MAX_LOG_ENTRIES = 200

const unsupportedTools = new Set([
  'gif_creator',
  'shortcuts_list',
  'shortcuts_execute',
  'update_plan',
])

export const BROWSER_TOOLS = [
  tool('tabs_context_mcp', 'List Playwright browser tabs managed by this local MCP server.'),
  tool('tabs_create_mcp', 'Create a new Playwright browser tab.', {
    url: stringProp('URL to open in the new tab. Defaults to about:blank.'),
  }),
  tool('navigate', 'Navigate a tab to a URL.', {
    tabId: numberProp('Tab id. Defaults to the active tab.'),
    url: stringProp('Destination URL.'),
  }, ['url']),
  tool('read_page', 'Read the current page title, URL, and visible text.', {
    tabId: numberProp('Tab id. Defaults to the active tab.'),
  }),
  tool('get_page_text', 'Read visible text from the current page.', {
    tabId: numberProp('Tab id. Defaults to the active tab.'),
  }),
  tool('find', 'Find text matches in the current page.', {
    tabId: numberProp('Tab id. Defaults to the active tab.'),
    query: stringProp('Text or regular expression to search for.'),
  }, ['query']),
  tool('form_input', 'Fill a form field identified by a CSS selector.', {
    tabId: numberProp('Tab id. Defaults to the active tab.'),
    selector: stringProp('CSS selector for the input element.'),
    text: stringProp('Text to enter.'),
  }, ['selector', 'text']),
  tool('computer', 'Perform simple mouse, keyboard, screenshot, or wait actions in a tab.', {
    tabId: numberProp('Tab id. Defaults to the active tab.'),
    action: stringProp('Action: screenshot, left_click, right_click, double_click, middle_click, type, key, scroll, wait, left_click_drag.'),
    coordinate: arrayProp('Target [x, y] coordinate.'),
    start_coordinate: arrayProp('Start [x, y] coordinate for drag.'),
    text: stringProp('Text or key name.'),
    duration: numberProp('Wait duration in seconds.'),
    scroll_direction: stringProp('Scroll direction: up, down, left, right.'),
    amount: numberProp('Scroll amount in wheel pixels.'),
  }, ['action']),
  tool('javascript_tool', 'Evaluate JavaScript in the current page.', {
    tabId: numberProp('Tab id. Defaults to the active tab.'),
    text: stringProp('JavaScript expression or function body to evaluate.'),
  }, ['text']),
  tool('resize_window', 'Resize the Playwright page viewport.', {
    tabId: numberProp('Tab id. Defaults to the active tab.'),
    width: numberProp('Viewport width in pixels.'),
    height: numberProp('Viewport height in pixels.'),
  }, ['width', 'height']),
  tool('read_console_messages', 'Read captured console messages for a tab.', {
    tabId: numberProp('Tab id. Defaults to the active tab.'),
    pattern: stringProp('Optional regular expression filter.'),
    onlyErrors: booleanProp('Only include error messages.'),
  }),
  tool('read_network_requests', 'Read captured network requests and responses for a tab.', {
    tabId: numberProp('Tab id. Defaults to the active tab.'),
    urlPattern: stringProp('Optional regular expression filter for URLs.'),
  }),
  tool('upload_image', 'Upload an image or file to an input[type=file] element.', {
    tabId: numberProp('Tab id. Defaults to the active tab.'),
    selector: stringProp('CSS selector for the file input.'),
    path: stringProp('File path to upload.'),
  }, ['selector', 'path']),
  ...[...unsupportedTools].map(name =>
    tool(name, `${name} is not implemented in the local Playwright replacement.`),
  ),
]

function tool(name, description, properties = {}, required = []) {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: true,
    },
  }
}

function stringProp(description) {
  return { type: 'string', description }
}

function numberProp(description) {
  return { type: 'number', description }
}

function booleanProp(description) {
  return { type: 'boolean', description }
}

function arrayProp(description) {
  return {
    type: 'array',
    description,
    items: { type: 'number' },
    minItems: 2,
    maxItems: 2,
  }
}

function textResult(value) {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  }
}

function errorResult(message) {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  }
}

function imageResult(data, mimeType = 'image/png') {
  return { content: [{ type: 'image', data, mimeType }] }
}

function truncate(text, max = MAX_TEXT_CHARS) {
  return text.length > max ? `${text.slice(0, max)}\n...[truncated]` : text
}

function makeRegex(pattern) {
  if (!pattern) return undefined
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  }
}

function normalizeTabId(raw) {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}

function normalizeCoordinate(value, name = 'coordinate') {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every(n => typeof n === 'number' && Number.isFinite(n))
  ) {
    throw new Error(`${name} must be a [x, y] number array`)
  }
  return { x: value[0], y: value[1] }
}

export function createClaudeForChromeMcpServer() {
  const server = new Server(
    { name: 'local-playwright-browser', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )
  const state = {
    browserPromise: undefined,
    contextPromise: undefined,
    pages: new Map(),
    activeTabId: undefined,
    nextTabId: 1,
    logs: new Map(),
    network: new Map(),
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: BROWSER_TOOLS,
  }))

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const args = params.arguments ?? {}
    try {
      if (unsupportedTools.has(params.name)) {
        return errorResult(
          `${params.name} is not available in the local Playwright browser automation implementation.`,
        )
      }
      switch (params.name) {
        case 'tabs_context_mcp':
          return textResult(await tabsContext(state))
        case 'tabs_create_mcp':
          return textResult(await createTab(state, args.url))
        case 'navigate':
          return textResult(await navigate(state, args))
        case 'read_page':
          return textResult(await readPage(state, args, true))
        case 'get_page_text':
          return textResult(await readPage(state, args, false))
        case 'find':
          return textResult(await findText(state, args))
        case 'form_input':
          return textResult(await formInput(state, args))
        case 'computer':
          return computerAction(state, args)
        case 'javascript_tool':
          return textResult(await evaluateJavaScript(state, args))
        case 'resize_window':
          return textResult(await resizeWindow(state, args))
        case 'read_console_messages':
          return textResult(readConsoleMessages(state, args))
        case 'read_network_requests':
          return textResult(readNetworkRequests(state, args))
        case 'upload_image':
          return textResult(await uploadImage(state, args))
        default:
          return errorResult(`Unknown local browser tool: ${params.name}`)
      }
    } catch (error) {
      return errorResult(error?.message ?? String(error))
    }
  })

  return server
}

async function getContext(state) {
  if (!state.contextPromise) {
    state.contextPromise = import('playwright').then(async ({ chromium }) => {
      const browser = await chromium.launch({
        headless: process.env.CLAUDE_CODE_BROWSER_HEADLESS !== '0',
      })
      state.browserPromise = Promise.resolve(browser)
      return browser.newContext({ viewport: { width: 1280, height: 900 } })
    })
  }
  return state.contextPromise
}

async function getPage(state, tabId) {
  const wantedTabId = tabId ?? state.activeTabId
  if (wantedTabId && state.pages.has(wantedTabId)) {
    state.activeTabId = wantedTabId
    return { tabId: wantedTabId, page: state.pages.get(wantedTabId) }
  }
  return createPage(state)
}

async function createPage(state, url = 'about:blank') {
  const context = await getContext(state)
  const page = await context.newPage()
  const tabId = state.nextTabId++
  state.pages.set(tabId, page)
  state.activeTabId = tabId
  state.logs.set(tabId, [])
  state.network.set(tabId, [])
  page.on('console', msg => {
    pushBounded(state.logs.get(tabId), {
      type: msg.type(),
      text: msg.text(),
      location: msg.location(),
      timestamp: new Date().toISOString(),
    })
  })
  page.on('request', request => {
    pushBounded(state.network.get(tabId), {
      event: 'request',
      method: request.method(),
      url: request.url(),
      timestamp: new Date().toISOString(),
    })
  })
  page.on('response', response => {
    pushBounded(state.network.get(tabId), {
      event: 'response',
      status: response.status(),
      url: response.url(),
      timestamp: new Date().toISOString(),
    })
  })
  if (url && url !== 'about:blank') {
    await page.goto(String(url), { waitUntil: 'domcontentloaded' })
  }
  return { tabId, page }
}

function pushBounded(list, entry) {
  if (!list) return
  list.push(entry)
  if (list.length > MAX_LOG_ENTRIES) {
    list.splice(0, list.length - MAX_LOG_ENTRIES)
  }
}

async function tabsContext(state) {
  const tabs = []
  for (const [tabId, page] of state.pages.entries()) {
    tabs.push({
      tabId,
      active: tabId === state.activeTabId,
      url: page.url(),
      title: await page.title().catch(() => ''),
      closed: page.isClosed(),
    })
  }
  return { tabs }
}

async function createTab(state, url) {
  const { tabId, page } = await createPage(state, typeof url === 'string' ? url : 'about:blank')
  return { tabId, url: page.url(), title: await page.title().catch(() => '') }
}

async function navigate(state, args) {
  if (typeof args.url !== 'string' || !args.url) {
    throw new Error('url is required')
  }
  const { tabId, page } = await getPage(state, normalizeTabId(args.tabId))
  await page.goto(args.url, { waitUntil: 'domcontentloaded' })
  return { tabId, url: page.url(), title: await page.title().catch(() => '') }
}

async function readPage(state, args, includeMetadata) {
  const { tabId, page } = await getPage(state, normalizeTabId(args.tabId))
  const text = truncate(
    await page.locator('body').innerText({ timeout: 3_000 }).catch(() => ''),
  )
  if (!includeMetadata) return { tabId, text }
  return {
    tabId,
    url: page.url(),
    title: await page.title().catch(() => ''),
    text,
  }
}

async function findText(state, args) {
  if (typeof args.query !== 'string' || !args.query) {
    throw new Error('query is required')
  }
  const { tabId, page } = await getPage(state, normalizeTabId(args.tabId))
  const bodyText = await page.locator('body').innerText({ timeout: 3_000 }).catch(() => '')
  const regex = makeRegex(args.query)
  const matches = []
  if (regex) {
    for (const line of bodyText.split(/\r?\n/)) {
      if (regex.test(line)) matches.push(truncate(line.trim(), 500))
      if (matches.length >= 50) break
    }
  }
  return { tabId, query: args.query, count: matches.length, matches }
}

async function formInput(state, args) {
  if (typeof args.selector !== 'string' || typeof args.text !== 'string') {
    throw new Error('selector and text are required')
  }
  const { tabId, page } = await getPage(state, normalizeTabId(args.tabId))
  await page.locator(args.selector).fill(args.text)
  return { tabId, selector: args.selector, filled: true }
}

async function computerAction(state, args) {
  if (typeof args.action !== 'string') {
    throw new Error('action is required')
  }
  const { tabId, page } = await getPage(state, normalizeTabId(args.tabId))
  switch (args.action) {
    case 'screenshot': {
      const data = (await page.screenshot({ fullPage: false })).toString('base64')
      return imageResult(data)
    }
    case 'left_click':
    case 'right_click':
    case 'middle_click':
    case 'double_click': {
      const { x, y } = normalizeCoordinate(args.coordinate)
      const button = args.action === 'right_click' ? 'right' : args.action === 'middle_click' ? 'middle' : 'left'
      await page.mouse.click(x, y, { button, clickCount: args.action === 'double_click' ? 2 : 1 })
      return textResult({ tabId, action: args.action, coordinate: [x, y] })
    }
    case 'left_click_drag': {
      const start = normalizeCoordinate(args.start_coordinate, 'start_coordinate')
      const end = normalizeCoordinate(args.coordinate)
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      await page.mouse.move(end.x, end.y)
      await page.mouse.up()
      return textResult({ tabId, action: args.action, start, end })
    }
    case 'type':
      await page.keyboard.type(String(args.text ?? ''))
      return textResult({ tabId, action: args.action, typed: true })
    case 'key':
      if (typeof args.text !== 'string' || !args.text) throw new Error('text is required for key')
      await page.keyboard.press(args.text)
      return textResult({ tabId, action: args.action, key: args.text })
    case 'scroll': {
      const amount = typeof args.amount === 'number' ? args.amount : 500
      const direction = typeof args.scroll_direction === 'string' ? args.scroll_direction : 'down'
      const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0
      const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0
      await page.mouse.wheel(dx, dy)
      return textResult({ tabId, action: args.action, direction, amount })
    }
    case 'wait': {
      const durationMs = Math.max(0, Number(args.duration ?? 1)) * 1000
      await page.waitForTimeout(durationMs)
      return textResult({ tabId, action: args.action, durationMs })
    }
    default:
      throw new Error(`Unsupported computer action: ${args.action}`)
  }
}

async function evaluateJavaScript(state, args) {
  if (typeof args.text !== 'string' || !args.text) {
    throw new Error('text is required')
  }
  const { tabId, page } = await getPage(state, normalizeTabId(args.tabId))
  const value = await page.evaluate(code => {
    // eslint-disable-next-line no-eval
    return eval(code)
  }, args.text)
  return { tabId, result: value }
}

async function resizeWindow(state, args) {
  if (typeof args.width !== 'number' || typeof args.height !== 'number') {
    throw new Error('width and height are required')
  }
  const { tabId, page } = await getPage(state, normalizeTabId(args.tabId))
  await page.setViewportSize({
    width: Math.round(args.width),
    height: Math.round(args.height),
  })
  return { tabId, width: Math.round(args.width), height: Math.round(args.height) }
}

function readConsoleMessages(state, args) {
  const tabId = normalizeTabId(args.tabId) ?? state.activeTabId
  const entries = [...(state.logs.get(tabId) ?? [])]
  const regex = makeRegex(args.pattern)
  return {
    tabId,
    messages: entries.filter(entry => {
      if (args.onlyErrors === true && entry.type !== 'error') return false
      return regex ? regex.test(entry.text) : true
    }),
  }
}

function readNetworkRequests(state, args) {
  const tabId = normalizeTabId(args.tabId) ?? state.activeTabId
  const entries = [...(state.network.get(tabId) ?? [])]
  const regex = makeRegex(args.urlPattern)
  return {
    tabId,
    requests: entries.filter(entry => (regex ? regex.test(entry.url) : true)),
  }
}

async function uploadImage(state, args) {
  if (typeof args.selector !== 'string' || typeof args.path !== 'string') {
    throw new Error('selector and path are required')
  }
  const { tabId, page } = await getPage(state, normalizeTabId(args.tabId))
  await page.locator(args.selector).setInputFiles(args.path)
  return { tabId, selector: args.selector, path: args.path, uploaded: true }
}
