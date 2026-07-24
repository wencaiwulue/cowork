import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

export const DEFAULT_GRANT_FLAGS = {}
export const API_RESIZE_PARAMS = {}

const unsupportedFeatureMessage =
  'This feature is not available in the local open-source Computer Use implementation.'

const TOOL_NAMES = [
  'screenshot',
  'cursor_position',
  'mouse_move',
  'left_click',
  'right_click',
  'double_click',
  'type',
  'key',
  'scroll',
  'wait',
  'read_clipboard',
  'write_clipboard',
  'computer_batch',
]

const unsupportedToolNames = new Set([
  'request_access',
  'list_granted_applications',
  'open_application',
  'zoom',
  'left_mouse_down',
  'left_mouse_up',
  'middle_click',
  'triple_click',
  'hold_key',
])

export function buildComputerUseTools() {
  return [
    tool('screenshot', 'Capture a screenshot of the primary desktop.'),
    tool('cursor_position', 'Return the current mouse cursor position.'),
    tool('mouse_move', 'Move the mouse cursor to a coordinate.', {
      coordinate: coordinateProp(),
    }, ['coordinate']),
    tool('left_click', 'Left-click at a coordinate.', {
      coordinate: coordinateProp(),
    }, ['coordinate']),
    tool('right_click', 'Right-click at a coordinate.', {
      coordinate: coordinateProp(),
    }, ['coordinate']),
    tool('double_click', 'Double-click at a coordinate.', {
      coordinate: coordinateProp(),
    }, ['coordinate']),
    tool('type', 'Type text with the system keyboard.', {
      text: stringProp('Text to type.'),
    }, ['text']),
    tool('key', 'Press a key or key combination, such as Enter or Command+V.', {
      text: stringProp('Key or key combination.'),
    }, ['text']),
    tool('scroll', 'Scroll at a coordinate or current cursor position.', {
      coordinate: coordinateProp(),
      direction: stringProp('Direction: up, down, left, right.'),
      amount: numberProp('Scroll amount in steps.'),
    }),
    tool('wait', 'Wait for a duration in seconds.', {
      duration: numberProp('Duration in seconds.'),
    }),
    tool('read_clipboard', 'Read text from the system clipboard.'),
    tool('write_clipboard', 'Write text to the system clipboard.', {
      text: stringProp('Text to write.'),
    }, ['text']),
    tool('computer_batch', 'Run multiple local Computer Use actions in order.', {
      actions: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
      },
    }, ['actions']),
    ...[...unsupportedToolNames].map(name =>
      tool(name, `${name}: ${unsupportedFeatureMessage}`),
    ),
  ]
}

export function createComputerUseMcpServer() {
  const server = new Server(
    { name: 'local-computer-use', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: buildComputerUseTools(),
  }))

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      return await callLocalComputerUseTool(params.name, params.arguments ?? {})
    } catch (error) {
      return errorResult(error?.message ?? String(error))
    }
  })

  return server
}

export function bindSessionContext() {
  return async (name, args) => callLocalComputerUseTool(name, args ?? {})
}

export function targetImageSize(width, height) {
  return [Math.round(width), Math.round(height)]
}

async function callLocalComputerUseTool(name, args) {
  if (unsupportedToolNames.has(name)) {
    return errorResult(`${name}: ${unsupportedFeatureMessage}`)
  }
  if (!TOOL_NAMES.includes(name)) {
    return errorResult(`Unknown local Computer Use tool: ${name}`)
  }

  switch (name) {
    case 'screenshot':
      return screenshot()
    case 'cursor_position':
      return textResult(await cursorPosition())
    case 'mouse_move':
      return textResult(await moveMouse(args))
    case 'left_click':
      return textResult(await clickMouse(args, 'left'))
    case 'right_click':
      return textResult(await clickMouse(args, 'right'))
    case 'double_click':
      return textResult(await clickMouse(args, 'double'))
    case 'type':
      return textResult(await typeText(args))
    case 'key':
      return textResult(await pressKey(args))
    case 'scroll':
      return textResult(await scroll(args))
    case 'wait':
      return textResult(await wait(args))
    case 'read_clipboard':
      return textResult({ text: await readClipboard() })
    case 'write_clipboard':
      return textResult(await writeClipboard(args))
    case 'computer_batch':
      return textResult(await computerBatch(args))
    default:
      return errorResult(`Unknown local Computer Use tool: ${name}`)
  }
}

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

function coordinateProp() {
  return {
    type: 'array',
    description: 'Coordinate as [x, y].',
    items: { type: 'number' },
    minItems: 2,
    maxItems: 2,
  }
}

function stringProp(description) {
  return { type: 'string', description }
}

function numberProp(description) {
  return { type: 'number', description }
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

function normalizeCoordinate(value, name = 'coordinate') {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every(n => typeof n === 'number' && Number.isFinite(n))
  ) {
    throw new Error(`${name} must be a [x, y] number array`)
  }
  return { x: Math.round(value[0]), y: Math.round(value[1]) }
}

async function loadNut() {
  return import('@nut-tree-fork/nut-js')
}

async function screenshot() {
  const mod = await import('screenshot-desktop')
  const capture = mod.default ?? mod
  const buffer = await capture({ format: 'png' })
  return {
    content: [
      {
        type: 'image',
        data: Buffer.from(buffer).toString('base64'),
        mimeType: 'image/png',
      },
    ],
  }
}

async function cursorPosition() {
  const { mouse } = await loadNut()
  const position = await mouse.getPosition()
  return { x: position.x, y: position.y }
}

async function moveMouse(args) {
  const { mouse, Point } = await loadNut()
  const { x, y } = normalizeCoordinate(args.coordinate)
  await mouse.setPosition(new Point(x, y))
  return { coordinate: [x, y] }
}

async function clickMouse(args, kind) {
  const { mouse, Point } = await loadNut()
  const { x, y } = normalizeCoordinate(args.coordinate)
  await mouse.setPosition(new Point(x, y))
  if (kind === 'right') {
    await mouse.rightClick()
  } else if (kind === 'double') {
    await mouse.doubleClick()
  } else {
    await mouse.leftClick()
  }
  return { action: kind === 'double' ? 'double_click' : `${kind}_click`, coordinate: [x, y] }
}

async function typeText(args) {
  if (typeof args.text !== 'string') throw new Error('text is required')
  const { keyboard } = await loadNut()
  await keyboard.type(args.text)
  return { typed: true, length: args.text.length }
}

async function pressKey(args) {
  if (typeof args.text !== 'string' || !args.text) {
    throw new Error('text is required')
  }
  const { keyboard } = await loadNut()
  const keys = await keysFromText(args.text)
  await keyboard.pressKey(...keys)
  await keyboard.releaseKey(...[...keys].reverse())
  return { key: args.text }
}

async function keysFromText(text) {
  const { Key } = await loadNut()
  const parts = text
    .split(/[+,\s]+/)
    .map(part => part.trim())
    .filter(Boolean)
  if (parts.length === 0) throw new Error('No key specified')
  return parts.map(part => keyFromName(Key, part))
}

function keyFromName(Key, name) {
  const normalized = name.toLowerCase()
  const aliases = {
    alt: 'LeftAlt',
    option: 'LeftAlt',
    control: 'LeftControl',
    ctrl: 'LeftControl',
    command: 'LeftCmd',
    cmd: 'LeftCmd',
    meta: 'LeftMeta',
    shift: 'LeftShift',
    enter: 'Enter',
    return: 'Return',
    esc: 'Escape',
    escape: 'Escape',
    space: 'Space',
    tab: 'Tab',
    backspace: 'Backspace',
    delete: 'Delete',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
  }
  const enumName =
    aliases[normalized] ??
    (/^[a-z]$/.test(normalized)
      ? normalized.toUpperCase()
      : /^[0-9]$/.test(normalized)
        ? `Num${normalized}`
        : name)
  if (!(enumName in Key)) {
    throw new Error(`Unsupported key: ${name}`)
  }
  return Key[enumName]
}

async function scroll(args) {
  const { mouse, Point } = await loadNut()
  if (args.coordinate !== undefined) {
    const { x, y } = normalizeCoordinate(args.coordinate)
    await mouse.setPosition(new Point(x, y))
  }
  const amount = Math.max(1, Math.round(Number(args.amount ?? 5)))
  const direction = typeof args.direction === 'string' ? args.direction : 'down'
  if (direction === 'up') await mouse.scrollUp(amount)
  else if (direction === 'left') await mouse.scrollLeft(amount)
  else if (direction === 'right') await mouse.scrollRight(amount)
  else await mouse.scrollDown(amount)
  return { direction, amount }
}

async function wait(args) {
  const durationMs = Math.max(0, Number(args.duration ?? 1)) * 1000
  await new Promise(resolve => setTimeout(resolve, durationMs))
  return { durationMs }
}

async function readClipboard() {
  const { default: clipboard } = await import('clipboardy')
  return clipboard.read()
}

async function writeClipboard(args) {
  if (typeof args.text !== 'string') throw new Error('text is required')
  const { default: clipboard } = await import('clipboardy')
  await clipboard.write(args.text)
  return { written: true, length: args.text.length }
}

async function computerBatch(args) {
  if (!Array.isArray(args.actions)) {
    throw new Error('actions must be an array')
  }
  const results = []
  for (const action of args.actions) {
    const name = action.name ?? action.tool ?? action.action
    if (typeof name !== 'string') {
      throw new Error('Each batch action needs a name, tool, or action string')
    }
    const result = await callLocalComputerUseTool(name, action)
    results.push({
      name,
      isError: result.isError === true,
      content: result.content,
    })
    if (result.isError) break
  }
  return { results }
}
