export function isContextCollapseEnabled(): boolean {
  return false
}

export function resetContextCollapse(): void {}

export function initContextCollapse(..._args: any[]): void {}

export function getStats(): any {
  return {
    collapsedMessages: [],
    collapsedSpans: [],
    health: {},
    stagedSpans: [],
  }
}

export function subscribe(_callback: () => void): () => void {
  return () => {}
}

export function applyCollapsesIfNeeded<T>(messages: T[], ..._args: any[]): {
  messages: T[]
} {
  return { messages }
}

export function isWithheldPromptTooLong(..._args: any[]): boolean {
  return false
}

export function recoverFromOverflow<T>(messages: T[], ..._args: any[]): {
  messages: T[]
  committed: number
} {
  return { messages, committed: 0 }
}

export default {
  getStats,
  applyCollapsesIfNeeded,
  isContextCollapseEnabled,
  isWithheldPromptTooLong,
  recoverFromOverflow,
  resetContextCollapse,
  subscribe,
}
