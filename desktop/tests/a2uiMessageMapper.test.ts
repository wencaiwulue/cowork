import { describe, expect, it } from 'vitest'
import { toDesktopMessages } from '../main/messageMapper'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A realistic A2UI v0.9.1 message array (createSurface + updateComponents). */
const A2UI_MESSAGES = [
  {
    version: 'v0.9.1',
    createSurface: { surfaceId: 'surf-1', catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json' },
  },
  {
    version: 'v0.9.1',
    updateComponents: {
      surfaceId: 'surf-1',
      components: [{ id: 'root', component: 'Card', title: 'Hello from MCP' }],
    },
  },
]

/**
 * Builds a realistic stream-json user message that carries an A2UI payload.
 * Mirrors the output of normalizeMessage() in queryHelpers.ts.
 */
function buildA2uiUserMessage(overrides?: {
  a2uiMessages?: unknown
  toolUseResult?: unknown
  messageContent?: unknown
}) {
  return {
    type: 'user',
    uuid: 'user-a2ui-1',
    message: {
      role: 'user',
      content: overrides?.messageContent ?? [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_abc123',
          content: '[A2UI surface rendered]',
        },
      ],
    },
    tool_use_result: overrides?.toolUseResult ?? {
      content: '[A2UI surface rendered]',
      _meta: {
        'a2ui/messages': overrides?.a2uiMessages ?? A2UI_MESSAGES,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('toDesktopMessages — A2UI payload extraction (happy path)', () => {
  it('extracts a2uiMessages, a2uiToolUseId, and a2uiSource from a valid MCP tool_result', () => {
    const messages = toDesktopMessages(buildA2uiUserMessage())
    expect(messages).toHaveLength(1)
    const msg = messages[0]
    expect(msg.role).toBe('tool_output')
    expect(msg.text).toBe('')
    expect(msg.a2uiMessages).toEqual(A2UI_MESSAGES)
    expect(msg.a2uiToolUseId).toBe('toolu_abc123')
    expect(msg.a2uiSource).toBe('mcp')
    expect(msg.id).toBe('user-a2ui-1')
    expect(typeof msg.timestamp).toBe('number')
  })

  it('sets raw to the original raw message object', () => {
    const raw = buildA2uiUserMessage()
    const [msg] = toDesktopMessages(raw)
    expect(msg.raw).toBe(raw)
  })
})

// ---------------------------------------------------------------------------
// Regression guard — tool-result without A2UI meta still returns []
// ---------------------------------------------------------------------------

describe('toDesktopMessages — non-A2UI tool_result regression guard', () => {
  it('returns [] for a tool_result user message that has no _meta a2ui/messages', () => {
    const raw = {
      type: 'user',
      uuid: 'user-tool-result-1',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_xyz',
            content: 'plain tool output',
          },
        ],
      },
      // No tool_use_result field at all
    }
    expect(toDesktopMessages(raw)).toEqual([])
  })

  it('returns [] when tool_use_result is present but _meta is missing', () => {
    const raw = buildA2uiUserMessage({
      toolUseResult: { content: 'plain tool output' },
    })
    expect(toDesktopMessages(raw)).toEqual([])
  })

  it('returns [] when tool_use_result._meta is present but a2ui/messages key is absent', () => {
    const raw = buildA2uiUserMessage({
      toolUseResult: {
        content: 'plain tool output',
        _meta: { 'other/key': 'value' },
      },
    })
    expect(toDesktopMessages(raw)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Malformed variants — must not throw
// ---------------------------------------------------------------------------

describe('toDesktopMessages — A2UI malformed variants (must not throw)', () => {
  it('returns [] when a2ui/messages is present but not an array', () => {
    const raw = buildA2uiUserMessage({
      toolUseResult: {
        content: 'x',
        _meta: { 'a2ui/messages': { notAnArray: true } },
      },
    })
    expect(toDesktopMessages(raw)).toEqual([])
  })

  it('returns [] when tool_use_result is a string (not a record)', () => {
    const raw = buildA2uiUserMessage({ toolUseResult: 'not-an-object' })
    expect(toDesktopMessages(raw)).toEqual([])
  })

  it('returns [] when tool_use_result is null', () => {
    // Build explicitly — cannot use buildA2uiUserMessage because null ?? default = default
    const raw = {
      type: 'user',
      uuid: 'user-a2ui-null',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_xyz', content: 'x' }],
      },
      tool_use_result: null,
    }
    expect(toDesktopMessages(raw)).toEqual([])
  })

  it('returns [] when _meta is a string (not a record)', () => {
    const raw = buildA2uiUserMessage({
      toolUseResult: { content: 'x', _meta: 'invalid' },
    })
    expect(toDesktopMessages(raw)).toEqual([])
  })

  it('still extracts a2uiMessages when message.content is not an array (a2uiToolUseId will be undefined)', () => {
    const raw = buildA2uiUserMessage({ messageContent: 'not-an-array' })
    const messages = toDesktopMessages(raw)
    expect(messages).toHaveLength(1)
    const msg = messages[0]
    expect(msg.role).toBe('tool_output')
    expect(msg.a2uiMessages).toEqual(A2UI_MESSAGES)
    expect(msg.a2uiToolUseId).toBeUndefined()
    expect(msg.a2uiSource).toBe('mcp')
  })

  it('does not throw on an empty a2ui/messages array', () => {
    const raw = buildA2uiUserMessage({ a2uiMessages: [] })
    // An empty array is still an array — treated as valid; yields tool_output
    expect(() => toDesktopMessages(raw)).not.toThrow()
    const messages = toDesktopMessages(raw)
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('tool_output')
    expect(messages[0].a2uiMessages).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Non-A2UI messages — unchanged existing behaviour
// ---------------------------------------------------------------------------

describe('toDesktopMessages — non-A2UI messages preserve existing behaviour', () => {
  it('renders a plain assistant text message', () => {
    const messages = toDesktopMessages({
      type: 'assistant',
      uuid: 'asst-1',
      message: {
        content: [{ type: 'text', text: 'Hello from assistant.' }],
      },
    })
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('assistant')
    expect(messages[0].text).toBe('Hello from assistant.')
    expect(messages[0].a2uiMessages).toBeUndefined()
    expect(messages[0].a2uiSource).toBeUndefined()
  })

  it('renders a plain user text message', () => {
    const messages = toDesktopMessages({
      type: 'user',
      uuid: 'user-plain-1',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Please help me.' }],
      },
    })
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(messages[0].text).toBe('Please help me.')
    expect(messages[0].a2uiMessages).toBeUndefined()
  })

  it('keeps returning [] for keep_alive, control_response, and system messages', () => {
    for (const raw of [
      { type: 'keep_alive' },
      { type: 'control_response' },
      { type: 'system', subtype: 'init' },
    ]) {
      expect(toDesktopMessages(raw)).toEqual([])
    }
  })
})
