import type { Message } from '../../types/message.js'

export const SNIP_NUDGE_TEXT = ''

export async function snipCompact() {
  return undefined
}

export function isSnipRuntimeEnabled(): boolean {
  return false
}

export function shouldNudgeForSnips(..._args: any[]): boolean {
  return false
}

export function isSnipMarkerMessage(_message: unknown): boolean {
  return false
}

export function snipCompactIfNeeded<T extends Message>(
  messages: T[],
  _options?: { force?: boolean },
): { messages: T[]; tokensFreed: number; boundaryMessage?: Message } {
  return { messages, tokensFreed: 0 }
}
