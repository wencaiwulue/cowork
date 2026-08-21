/**
 * Runtime component tests for A2uiSurfaceHost.
 *
 * These actually render the React component tree using @testing-library/react
 * and verify DOM output.  Design doc §6.2.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { A2uiSurfaceHost } from '../../renderer/src/a2ui/A2uiSurfaceHost'
import { A2uiSessionProcessor } from '../../renderer/src/a2ui/A2uiSessionProcessor'
import type { DesktopMessage } from '../../main/ipc'

afterEach(() => cleanup())

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ingestAndGetSurface(
  processor: A2uiSessionProcessor,
  sessionId: string,
  message: DesktopMessage,
) {
  processor.ingest(sessionId, message)
  const surfaces = processor.getSurfacesForMessage(sessionId, message.id)
  if (surfaces.length === 0) throw new Error(`No surfaces created for message ${message.id}`)
  return surfaces[0]
}

function makeMessage(
  id: string,
  a2uiMessages: unknown[],
  toolUseId = 'tool-use-1',
): DesktopMessage {
  return {
    id,
    role: 'tool_output',
    text: '',
    timestamp: Date.now(),
    a2uiMessages,
    a2uiToolUseId: toolUseId,
    a2uiSource: 'mcp',
  }
}

const CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'

// ---------------------------------------------------------------------------
// Fixture: simple text surface
// ---------------------------------------------------------------------------

const simpleTextMessages = [
  {
    version: 'v0.9',
    createSurface: {
      surfaceId: 'surface-text-test',
      catalogId: CATALOG_ID,
    },
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'surface-text-test',
      components: [
        {
          id: 'root',
          component: 'Text',
          text: 'Hello, A2UI World!',
          variant: 'h1',
        },
      ],
    },
  },
]

// ---------------------------------------------------------------------------
// Fixture: interactive button surface
// ---------------------------------------------------------------------------

const interactiveButtonMessages = [
  {
    version: 'v0.9',
    createSurface: {
      surfaceId: 'surface-button-test',
      catalogId: CATALOG_ID,
    },
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'surface-button-test',
      components: [
        {
          id: 'root',
          component: 'Column',
          children: ['btn'],
        },
        {
          id: 'btn',
          component: 'Button',
          child: 'btn-label',
          variant: 'primary',
          action: {
            event: {
              name: 'test_click',
              context: {},
            },
          },
        },
        {
          id: 'btn-label',
          component: 'Text',
          text: 'Click Me',
        },
      ],
    },
  },
]

// ---------------------------------------------------------------------------
// Tests: simple text fixture
// ---------------------------------------------------------------------------

describe('A2uiSurfaceHost — simple text fixture', () => {
  it('renders without throwing', () => {
    const processor = new A2uiSessionProcessor()
    const msg = makeMessage('msg-text', simpleTextMessages)
    const anchored = ingestAndGetSurface(processor, 'sess', msg)
    expect(() => render(<A2uiSurfaceHost anchored={anchored} />)).not.toThrow()
    processor.disposeAll()
  })

  it('renders visible text from the fixture in the DOM', () => {
    const processor = new A2uiSessionProcessor()
    const msg = makeMessage('msg-text-2', simpleTextMessages.map(m => {
      // Use a unique surfaceId to avoid collision with previous tests
      if ('createSurface' in m) return { ...m, createSurface: { ...m.createSurface, surfaceId: 'surf-text-visible' } }
      if ('updateComponents' in m) return { ...m, updateComponents: { ...(m as any).updateComponents, surfaceId: 'surf-text-visible' } }
      return m
    }))
    const anchored = ingestAndGetSurface(processor, 'sess2', msg)
    render(<A2uiSurfaceHost anchored={anchored} />)
    expect(screen.getByText('Hello, A2UI World!')).toBeInTheDocument()
    processor.disposeAll()
  })

  it('renders the a2ui-surface-host container div', () => {
    const processor = new A2uiSessionProcessor()
    const messages = [
      { version: 'v0.9', createSurface: { surfaceId: 'surf-container', catalogId: CATALOG_ID } },
      { version: 'v0.9', updateComponents: { surfaceId: 'surf-container', components: [{ id: 'root', component: 'Text', text: 'Test' }] } },
    ]
    const msg = makeMessage('msg-container', messages)
    const anchored = ingestAndGetSurface(processor, 'sess-container', msg)
    const { container } = render(<A2uiSurfaceHost anchored={anchored} />)
    expect(container.querySelector('.a2ui-surface-host')).not.toBeNull()
    processor.disposeAll()
  })
})

// ---------------------------------------------------------------------------
// Tests: phantom prop
// ---------------------------------------------------------------------------

describe('A2uiSurfaceHost — phantom prop', () => {
  it('renders [Surface no longer active] placeholder when phantom=true', () => {
    const processor = new A2uiSessionProcessor()
    const messages = [
      { version: 'v0.9', createSurface: { surfaceId: 'surf-phantom', catalogId: CATALOG_ID } },
      { version: 'v0.9', updateComponents: { surfaceId: 'surf-phantom', components: [{ id: 'root', component: 'Text', text: 'Phantom Surface' }] } },
    ]
    const msg = makeMessage('msg-phantom', messages)
    const anchored = ingestAndGetSurface(processor, 'sess-phantom', msg)
    render(<A2uiSurfaceHost anchored={anchored} phantom={true} />)
    expect(screen.getByText('[Surface no longer active]')).toBeInTheDocument()
    processor.disposeAll()
  })

  it('does not render surface content when phantom=true', () => {
    const processor = new A2uiSessionProcessor()
    const messages = [
      { version: 'v0.9', createSurface: { surfaceId: 'surf-phantom2', catalogId: CATALOG_ID } },
      { version: 'v0.9', updateComponents: { surfaceId: 'surf-phantom2', components: [{ id: 'root', component: 'Text', text: 'Should not appear' }] } },
    ]
    const msg = makeMessage('msg-phantom2', messages)
    const anchored = ingestAndGetSurface(processor, 'sess-phantom2', msg)
    render(<A2uiSurfaceHost anchored={anchored} phantom={true} />)
    expect(screen.queryByText('Should not appear')).toBeNull()
    processor.disposeAll()
  })

  it('phantom container has a2ui-surface-phantom class', () => {
    const processor = new A2uiSessionProcessor()
    const messages = [
      { version: 'v0.9', createSurface: { surfaceId: 'surf-phantom3', catalogId: CATALOG_ID } },
      { version: 'v0.9', updateComponents: { surfaceId: 'surf-phantom3', components: [{ id: 'root', component: 'Text', text: 'x' }] } },
    ]
    const msg = makeMessage('msg-phantom3', messages)
    const anchored = ingestAndGetSurface(processor, 'sess-phantom3', msg)
    const { container } = render(<A2uiSurfaceHost anchored={anchored} phantom={true} />)
    expect(container.querySelector('.a2ui-surface-phantom')).not.toBeNull()
    processor.disposeAll()
  })
})

// ---------------------------------------------------------------------------
// Tests: interactive button fixture
// ---------------------------------------------------------------------------

describe('A2uiSurfaceHost — interactive button fixture', () => {
  it('renders a <button> element', () => {
    const processor = new A2uiSessionProcessor()
    const msg = makeMessage('msg-btn', interactiveButtonMessages)
    const anchored = ingestAndGetSurface(processor, 'sess-btn', msg)
    render(<A2uiSurfaceHost anchored={anchored} />)
    const btn = screen.getByRole('button')
    expect(btn).toBeInTheDocument()
    processor.disposeAll()
  })

  it('button renders child text content "Click Me"', () => {
    const processor = new A2uiSessionProcessor()
    const msg = makeMessage('msg-btn-label', interactiveButtonMessages.map(m => {
      if ('createSurface' in m) return { ...m, createSurface: { ...m.createSurface, surfaceId: 'surf-btn-label' } }
      if ('updateComponents' in m) return { ...m, updateComponents: { ...(m as any).updateComponents, surfaceId: 'surf-btn-label' } }
      return m
    }))
    const anchored = ingestAndGetSurface(processor, 'sess-btn-label', msg)
    render(<A2uiSurfaceHost anchored={anchored} />)
    expect(screen.getByText('Click Me')).toBeInTheDocument()
    processor.disposeAll()
  })

  it('clicking the button on an MCP-sourced surface logs a Phase-3 gap warning', () => {
    // In Phase 2, MCP-originated surfaces still cannot route actions back
    // (Phase 3 gap). The action still fires through @a2ui/web_core but the
    // callback logs a warning instead of routing via IPC.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const processor = new A2uiSessionProcessor()
    const messages = [
      { version: 'v0.9', createSurface: { surfaceId: 'surf-click', catalogId: CATALOG_ID } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'surf-click',
          components: [
            { id: 'root', component: 'Button', child: 'lbl', action: { event: { name: 'click_me', context: {} } } },
            { id: 'lbl', component: 'Text', text: 'Press' },
          ],
        },
      },
    ]
    const msg = makeMessage('msg-click', messages)
    const anchored = ingestAndGetSurface(processor, 'sess-click', msg)
    render(<A2uiSurfaceHost anchored={anchored} />)

    const btn = screen.getByRole('button')
    expect(() => fireEvent.click(btn)).not.toThrow()

    // Phase 2: MCP surfaces log the Phase-3 gap warning (not Phase-1 gap)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[A2UI Phase-3 gap]'),
    )
    warnSpy.mockRestore()
    processor.disposeAll()
  })
})

// ---------------------------------------------------------------------------
// Tests: ErrorBoundary behavior
// ---------------------------------------------------------------------------

describe('A2uiSurfaceHost — ErrorBoundary', () => {
  it('renders an error state without crashing the outer tree when A2uiSurface throws', () => {
    // Feed a surface where the root component is missing (updateComponents
    // has no root — the component ID "root" is referenced but not defined).
    // The renderer should catch via ErrorBoundary.
    const processor = new A2uiSessionProcessor()
    const errorMessages = [
      {
        version: 'v0.9',
        createSurface: { surfaceId: 'surf-error', catalogId: CATALOG_ID },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'surf-error',
          // Intentionally omit the "root" component to provoke a rendering issue
          components: [
            { id: 'not-root', component: 'Text', text: 'Orphaned' },
          ],
        },
      },
    ]
    const msg = makeMessage('msg-error', errorMessages)
    const anchored = ingestAndGetSurface(processor, 'sess-error', msg)

    // The component should render without throwing at the React tree level
    // (ErrorBoundary catches any render error from A2uiSurface)
    expect(() => render(<A2uiSurfaceHost anchored={anchored} />)).not.toThrow()
    processor.disposeAll()
  })
})
