/**
 * A2uiSurfaceHost — renders a single A2UI surface inside a themed container.
 *
 * Wraps <A2uiSurface> (from @a2ui/react/v0_9) with:
 *  - MarkdownContext providing the @a2ui/markdown-it renderer
 *  - An inline ErrorBoundary so a malformed surface cannot crash the renderer
 *  - CSS variable + a2ui-dark/light class management via themeBridge
 */

import React from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { A2uiSurface, MarkdownContext } from '@a2ui/react/v0_9'
import { renderMarkdown } from '@a2ui/markdown-it'
import type { AnchoredSurface } from './A2uiSessionProcessor'
import { initThemeBridge } from './themeBridge'

// ---------------------------------------------------------------------------
// Error boundary (follows the pattern in desktop/renderer/src/main.tsx)
// ---------------------------------------------------------------------------

type EBState = { error: Error | null }
type EBProps = { children: ReactNode; surfaceId: string }

class SurfaceErrorBoundary extends React.Component<EBProps, EBState> {
  declare readonly props: Readonly<EBProps>

  state: EBState = { error: null }

  static getDerivedStateFromError(error: Error): EBState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[A2uiSurfaceHost] Surface "${this.props.surfaceId}" crashed:`,
      error,
      info.componentStack,
    )
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="a2ui-surface-error" role="alert" aria-live="polite">
          <span>Surface rendering error: {this.state.error.message}</span>
        </div>
      )
    }
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------

export interface A2uiSurfaceHostProps {
  anchored: AnchoredSurface
  /** When true, render a collapsed placeholder instead of the live surface. */
  phantom?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const A2uiSurfaceHost: React.FC<A2uiSurfaceHostProps> = ({ anchored, phantom }) => {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    return initThemeBridge(el)
  }, [])

  if (phantom) {
    return (
      <div className="a2ui-surface-host a2ui-surface-phantom" aria-hidden="true">
        <span className="a2ui-surface-phantom-label">[Surface no longer active]</span>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="a2ui-surface-host">
      <SurfaceErrorBoundary surfaceId={anchored.surface.id}>
        <MarkdownContext.Provider value={renderMarkdown}>
          <A2uiSurface surface={anchored.surface} />
        </MarkdownContext.Provider>
      </SurfaceErrorBoundary>
    </div>
  )
}
