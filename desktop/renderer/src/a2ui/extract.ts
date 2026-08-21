/**
 * Pure extraction helpers: read A2UI payload fields that the main-process
 * messageMapper attaches to DesktopMessage before forwarding to the renderer.
 *
 * This module has NO React / DOM dependencies and is safe to run in a Node
 * test environment without jsdom.
 */
import type { DesktopMessage } from '../../../main/ipc'

/**
 * Extracts A2UI data already attached to a DesktopMessage by the main-process
 * messageMapper.  The fields were decoded from the stream-json pipeline and
 * attached by the other agent's messageMapper changes.
 *
 * Returns null if the message carries no A2UI payload.  Never throws.
 */
export function extractA2uiFromMessage(message: DesktopMessage): {
  a2uiMessages: unknown[]
  a2uiToolUseId: string
  a2uiSource: 'mcp' | 'built-in'
} | null {
  try {
    const msgs = message.a2uiMessages
    const toolUseId = message.a2uiToolUseId
    const source = message.a2uiSource

    if (
      !Array.isArray(msgs) ||
      msgs.length === 0 ||
      typeof toolUseId !== 'string' ||
      toolUseId.length === 0 ||
      (source !== 'mcp' && source !== 'built-in')
    ) {
      return null
    }

    return { a2uiMessages: msgs, a2uiToolUseId: toolUseId, a2uiSource: source }
  } catch {
    return null
  }
}
