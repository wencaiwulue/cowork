/**
 * A2uiSessionProcessor — owns one MessageProcessor per session.
 *
 * Responsibilities (per design doc §5.1):
 *  - Lazily create a MessageProcessor for each session
 *  - Feed a2uiMessages from DesktopMessages into the processor
 *  - Track surfaceId → anchorMessageId so the render loop can place each
 *    surface next to the message that introduced it
 *  - Guard against double-processing the same message id (idempotent replay §R3)
 *  - Subscribe to onSurfaceCreated / onSurfaceDeleted and notify change listeners
 *  - Phase 1 action callback is a no-op that logs a clear warning (Phase 3 gap)
 */

import { MessageProcessor } from '@a2ui/web_core/v0_9'
import { basicCatalog, type ReactComponentImplementation } from '@a2ui/react/v0_9'
import type { SurfaceModel } from '@a2ui/web_core/v0_9'
import type { DesktopMessage } from '../../../main/ipc'
import { extractA2uiFromMessage } from './extract'

export interface AnchoredSurface {
  surface: SurfaceModel<ReactComponentImplementation>
  anchorMessageId: string
  toolUseId: string
  source: 'mcp' | 'built-in'
}

interface SessionState {
  processor: MessageProcessor<ReactComponentImplementation>
  /** surfaceId → AnchoredSurface */
  surfaces: Map<string, AnchoredSurface>
  /** message ids already ingested — guards against duplicate replay */
  processedMessageIds: Set<string>
  /** subscription disposers */
  disposers: Array<() => void>
  /** pending anchor context while processMessages() runs */
  pendingAnchor: { messageId: string; toolUseId: string; source: 'mcp' | 'built-in' } | null
}

/**
 * Central processor for a set of A2UI sessions.
 *
 * Lifecycle: construct once (e.g. in a React ref), call `ingest()` on each
 * incoming DesktopMessage, call `dispose(sessionId)` on session close, and
 * call `disposeAll()` when the component unmounts.
 */
export class A2uiSessionProcessor {
  private readonly sessions = new Map<string, SessionState>()
  private readonly changeListeners = new Set<() => void>()

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Ingest a DesktopMessage.  If it carries a2uiMessages, feed them into the
   * per-session processor and record anchor metadata.  Idempotent on the same
   * message.id.
   */
  ingest(sessionId: string, message: DesktopMessage): void {
    const extracted = extractA2uiFromMessage(message)
    if (!extracted) return

    const state = this.getOrCreate(sessionId)

    // Guard against double-processing (idempotent replay per §R3)
    if (state.processedMessageIds.has(message.id)) return
    state.processedMessageIds.add(message.id)

    // Set pending anchor so the onSurfaceCreated callback can bind it
    state.pendingAnchor = {
      messageId: message.id,
      toolUseId: extracted.a2uiToolUseId,
      source: extracted.a2uiSource,
    }

    try {
      state.processor.processMessages(extracted.a2uiMessages as Parameters<typeof state.processor.processMessages>[0])
    } catch (err) {
      console.error('[A2uiSessionProcessor] processMessages threw:', err)
      // Route validation/render errors back through IPC when source is built-in
      if (extracted.a2uiSource === 'built-in' && extracted.a2uiToolUseId) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const win = window as Window & { claudeDesktop?: { sessions?: { reportA2uiError?: (sessionId: string, input: { toolUseId: string; error: { code: string; surfaceId: string; message: string } }) => Promise<void> } } }
        if (win.claudeDesktop?.sessions?.reportA2uiError) {
          win.claudeDesktop.sessions.reportA2uiError(sessionId, {
            toolUseId: extracted.a2uiToolUseId,
            error: {
              code: 'RENDER_ERROR',
              surfaceId: '(unknown)',
              message: errMsg,
            },
          }).catch((e: unknown) => console.error('[A2UI] reportA2uiError failed:', e))
        }
      }
    } finally {
      state.pendingAnchor = null
    }
  }

  /**
   * Returns surfaces anchored to `messageId` in creation order.
   */
  getSurfacesForMessage(sessionId: string, messageId: string): AnchoredSurface[] {
    const state = this.sessions.get(sessionId)
    if (!state) return []
    return Array.from(state.surfaces.values()).filter(
      a => a.anchorMessageId === messageId,
    )
  }

  /**
   * Replay all stored messages in order (used on session restore).
   * Creates a fresh processor for the session; safe to call multiple times
   * because ingest() is idempotent on message.id.
   */
  replay(sessionId: string, messages: DesktopMessage[]): void {
    for (const msg of messages) {
      this.ingest(sessionId, msg)
    }
  }

  /**
   * Dispose a single session: unsubscribe events, clear surfaces & state.
   */
  dispose(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    for (const d of state.disposers) d()
    this.sessions.delete(sessionId)
    this.notifyChange()
  }

  /** Dispose all sessions. */
  disposeAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.dispose(sessionId)
    }
  }

  /**
   * Subscribe to surface-set changes.  The callback fires whenever a surface
   * is created or deleted in ANY session.  Returns an unsubscribe function.
   */
  subscribe(cb: () => void): () => void {
    this.changeListeners.add(cb)
    return () => this.changeListeners.delete(cb)
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getOrCreate(sessionId: string): SessionState {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing

    const processor = new MessageProcessor<ReactComponentImplementation>(
      [basicCatalog],
      (action) => {
        const surfaceId = (action as { surfaceId?: string }).surfaceId ?? '(unknown)'
        const name = (action as { name?: string }).name ?? '(unknown)'
        // Look up the anchored surface to determine provenance
        const anchored = surfaces.get(surfaceId)
        if (!anchored) {
          console.warn(
            `[A2UI] Action received on unknown surface "${surfaceId}" (name: "${name}") ` +
            `for session "${sessionId}". Surface may have been deleted.`,
          )
          return
        }
        if (anchored.source === 'built-in' && anchored.toolUseId) {
          // Phase 2: route action back via IPC to the deferred RenderUI tool call
          const payload = {
            version: 'v0.9.1' as const,
            action: {
              name,
              surfaceId,
              sourceComponentId: (action as { sourceComponentId?: string }).sourceComponentId ?? '',
              timestamp: new Date().toISOString(),
              context: (action as { context?: Record<string, unknown> }).context ?? {},
            },
          }
          const win = window as Window & { claudeDesktop?: { sessions?: { submitA2uiAction?: (sessionId: string, input: { toolUseId: string; action: typeof payload['action'] }) => Promise<void> } } }
          if (win.claudeDesktop?.sessions?.submitA2uiAction) {
            win.claudeDesktop.sessions.submitA2uiAction(sessionId, {
              toolUseId: anchored.toolUseId,
              action: payload.action,
            }).catch((err: unknown) => {
              console.error('[A2UI] submitA2uiAction failed:', err)
            })
          } else {
            console.error('[A2UI] window.claudeDesktop.sessions.submitA2uiAction is unavailable')
          }
        } else if (anchored.source === 'mcp') {
          // Phase 3 gap: MCP-originated surfaces cannot route actions back yet.
          // Keep warning so the gap is visible rather than silent.
          console.warn(
            `[A2UI Phase-3 gap] Action received on MCP-originated surface "${surfaceId}" ` +
            `(name: "${name}") for session "${sessionId}". ` +
            'MCP action return is not yet implemented (Phase 3).',
          )
        } else {
          console.warn(
            `[A2UI] Action received on surface "${surfaceId}" (name: "${name}") ` +
            `for session "${sessionId}" with unknown source "${anchored.source}".`,
          )
        }
      },
    )

    const surfaces = new Map<string, AnchoredSurface>()
    const processedMessageIds = new Set<string>()
    const disposers: Array<() => void> = []
    const state: SessionState = {
      processor,
      surfaces,
      processedMessageIds,
      disposers,
      pendingAnchor: null,
    }

    const sub1 = processor.onSurfaceCreated((surface) => {
      const anchor = state.pendingAnchor
      if (!anchor) {
        console.warn('[A2uiSessionProcessor] surface created outside of ingest(); cannot anchor:', surface.id)
        return
      }
      surfaces.set(surface.id, {
        surface,
        anchorMessageId: anchor.messageId,
        toolUseId: anchor.toolUseId,
        source: anchor.source,
      })
      this.notifyChange()
    })

    const sub2 = processor.onSurfaceDeleted((id) => {
      surfaces.delete(id)
      this.notifyChange()
    })

    disposers.push(() => sub1.unsubscribe(), () => sub2.unsubscribe())

    this.sessions.set(sessionId, state)
    return state
  }

  private notifyChange(): void {
    for (const cb of this.changeListeners) {
      try { cb() } catch { /* ignore listener errors */ }
    }
  }
}
