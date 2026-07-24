import { describe, expect, it } from 'vitest'
import { createNdjsonParser } from '../main/ndjson'

describe('createNdjsonParser', () => {
  it('emits complete JSON objects across split chunks and ignores malformed lines', () => {
    const messages: unknown[] = []
    const parser = createNdjsonParser(message => messages.push(message))

    parser.push('{"type":"system","subtype":"init"}\n{"type"')
    parser.push(':"assistant","message":{"content":[{"type":"text","text":"hi"}]}}\n')
    parser.push('not json\n{"type":"keep_alive"}\n')

    expect(messages).toEqual([
      { type: 'system', subtype: 'init' },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hi' }] },
      },
      { type: 'keep_alive' },
    ])
  })

  it('flushes a final unterminated JSON line', () => {
    const messages: unknown[] = []
    const parser = createNdjsonParser(message => messages.push(message))

    parser.push('{"type":"result","subtype":"success"}')
    parser.flush()

    expect(messages).toEqual([{ type: 'result', subtype: 'success' }])
  })
})
