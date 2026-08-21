/**
 * Runtime tests for A2uiSessionProcessor.
 *
 * These execute in jsdom and actually import and run the A2UI renderer modules
 * rather than just reading source files.  Design doc §6.2.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { A2uiSessionProcessor } from '../../renderer/src/a2ui/A2uiSessionProcessor'
import type { DesktopMessage } from '../../main/ipc'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(
  overrides: Partial<DesktopMessage> & { id: string },
): DesktopMessage {
  return {
    role: 'tool_output',
    text: '',
    timestamp: Date.now(),
    ...overrides,
  }
}

/** A minimal createSurface + updateComponents payload matching the spec. */
function simpleTextMessages(surfaceId: string) {
  return [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId,
        catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'root',
            component: 'Text',
            text: 'Hello World',
            variant: 'body',
          },
        ],
      },
    },
  ]
}

/** A message carrying A2UI payload. */
function a2uiMessage(id: string, surfaceId: string): DesktopMessage {
  return makeMessage({
    id,
    a2uiMessages: simpleTextMessages(surfaceId),
    a2uiToolUseId: `tool-${id}`,
    a2uiSource: 'mcp',
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('A2uiSessionProcessor', () => {
  let processor: A2uiSessionProcessor
  const actionCb = vi.fn()
  const errorCb = vi.fn()

  beforeEach(() => {
    processor = new A2uiSessionProcessor()
    actionCb.mockReset()
    errorCb.mockReset()
  })

  it('getSurfacesForMessage returns empty array for unknown messageId', () => {
    expect(processor.getSurfacesForMessage('session-1', 'msg-999')).toEqual([])
  })

  it('getSurfacesForMessage returns empty array for unknown sessionId', () => {
    expect(processor.getSurfacesForMessage('no-such-session', 'msg-1')).toEqual([])
  })

  it('ingest with a2uiMessages creates a surface anchored to anchorMessageId', () => {
    const msg = a2uiMessage('msg-1', 'surf-1')
    processor.ingest('session-1', msg)
    const surfaces = processor.getSurfacesForMessage('session-1', 'msg-1')
    expect(surfaces).toHaveLength(1)
    expect(surfaces[0].anchorMessageId).toBe('msg-1')
    expect(surfaces[0].toolUseId).toBe('tool-msg-1')
    expect(surfaces[0].source).toBe('mcp')
    expect(surfaces[0].surface).toBeDefined()
  })

  it('ingest with no a2uiMessages does not create a surface', () => {
    const msg = makeMessage({ id: 'msg-plain' })
    processor.ingest('session-1', msg)
    expect(processor.getSurfacesForMessage('session-1', 'msg-plain')).toEqual([])
  })

  it('ingest with empty a2uiMessages array does not create a surface', () => {
    const msg = makeMessage({
      id: 'msg-empty',
      a2uiMessages: [],
      a2uiToolUseId: 'tool-x',
      a2uiSource: 'mcp',
    })
    processor.ingest('session-1', msg)
    expect(processor.getSurfacesForMessage('session-1', 'msg-empty')).toEqual([])
  })

  it('idempotent replay — ingesting same message twice does not duplicate surfaces (risk R3)', () => {
    const msg = a2uiMessage('msg-2', 'surf-2')
    processor.ingest('session-1', msg)
    processor.ingest('session-1', msg) // second time — should be no-op
    const surfaces = processor.getSurfacesForMessage('session-1', 'msg-2')
    expect(surfaces).toHaveLength(1)
  })

  it('replay() produces same surface state as sequential ingest() calls', () => {
    // Use two separate processor instances to compare
    const pDirect = new A2uiSessionProcessor()
    const pReplay = new A2uiSessionProcessor()

    const msgs = [
      a2uiMessage('msg-A', 'surf-A'),
      makeMessage({ id: 'msg-B' }), // no A2UI payload
      a2uiMessage('msg-C', 'surf-C'),
    ]

    for (const m of msgs) pDirect.ingest('sess', m)
    pReplay.replay('sess', msgs)

    expect(pDirect.getSurfacesForMessage('sess', 'msg-A')).toHaveLength(1)
    expect(pReplay.getSurfacesForMessage('sess', 'msg-A')).toHaveLength(1)
    expect(pDirect.getSurfacesForMessage('sess', 'msg-C')).toHaveLength(1)
    expect(pReplay.getSurfacesForMessage('sess', 'msg-C')).toHaveLength(1)
    expect(pDirect.getSurfacesForMessage('sess', 'msg-B')).toHaveLength(0)
    expect(pReplay.getSurfacesForMessage('sess', 'msg-B')).toHaveLength(0)
  })

  it('replay() after prior ingest is idempotent (R3 double-replay guard)', () => {
    const msgs = [a2uiMessage('msg-D', 'surf-D')]
    processor.replay('sess-r', msgs)
    processor.replay('sess-r', msgs) // second replay
    expect(processor.getSurfacesForMessage('sess-r', 'msg-D')).toHaveLength(1)
  })

  it('dispose(sessionId) clears surfaces for that session', () => {
    const msg = a2uiMessage('msg-3', 'surf-3')
    processor.ingest('sess-dispose', msg)
    expect(processor.getSurfacesForMessage('sess-dispose', 'msg-3')).toHaveLength(1)
    processor.dispose('sess-dispose')
    expect(processor.getSurfacesForMessage('sess-dispose', 'msg-3')).toEqual([])
  })

  it('dispose(sessionId) does not affect other sessions', () => {
    const msg1 = a2uiMessage('msg-X', 'surf-X')
    const msg2 = a2uiMessage('msg-Y', 'surf-Y')
    processor.ingest('sess-keep', msg1)
    processor.ingest('sess-gone', msg2)
    processor.dispose('sess-gone')
    expect(processor.getSurfacesForMessage('sess-keep', 'msg-X')).toHaveLength(1)
    expect(processor.getSurfacesForMessage('sess-gone', 'msg-Y')).toEqual([])
  })

  it('disposeAll clears all sessions', () => {
    processor.ingest('s1', a2uiMessage('m1', 'surf-s1'))
    processor.ingest('s2', a2uiMessage('m2', 'surf-s2'))
    processor.disposeAll()
    expect(processor.getSurfacesForMessage('s1', 'm1')).toEqual([])
    expect(processor.getSurfacesForMessage('s2', 'm2')).toEqual([])
  })

  it('subscribe callback fires when a surface is created', () => {
    const listener = vi.fn()
    const unsub = processor.subscribe(listener)
    processor.ingest('sess-sub', a2uiMessage('msg-sub', 'surf-sub'))
    expect(listener).toHaveBeenCalled()
    unsub()
  })

  it('unsubscribed callback is not fired', () => {
    const listener = vi.fn()
    const unsub = processor.subscribe(listener)
    unsub()
    processor.ingest('sess-unsub', a2uiMessage('msg-unsub', 'surf-unsub'))
    expect(listener).not.toHaveBeenCalled()
  })

  it('surface.id on the SurfaceModel matches the surfaceId from the message', () => {
    processor.ingest('sess-id', a2uiMessage('msg-id', 'my-surf-id'))
    const surfaces = processor.getSurfacesForMessage('sess-id', 'msg-id')
    expect(surfaces[0].surface.id).toBe('my-surf-id')
  })

  it('multiple surfaces from different messages accumulate correctly', () => {
    processor.ingest('s', a2uiMessage('m1', 'surf-multi-1'))
    processor.ingest('s', a2uiMessage('m2', 'surf-multi-2'))
    expect(processor.getSurfacesForMessage('s', 'm1')).toHaveLength(1)
    expect(processor.getSurfacesForMessage('s', 'm2')).toHaveLength(1)
  })
})
