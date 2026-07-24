export type CachedMCState = any
export type CacheEditsBlock = any
export type PinnedCacheEdits = any

export async function cachedMicrocompact() {
  return undefined
}

export function createCachedMCState(): CachedMCState {
  return {
    registeredTools: new Set<string>(),
    pinnedEdits: [],
  }
}

export function markToolsSentToAPI(_state: CachedMCState): void {}

export function resetCachedMCState(state: CachedMCState): void {
  state.registeredTools?.clear?.()
  state.pinnedEdits = []
}

export function isCachedMicrocompactEnabled(): boolean {
  return false
}

export function isModelSupportedForCacheEditing(_model: unknown): boolean {
  return false
}

export function getCachedMCConfig(): any {
  return {}
}

export function registerToolResult(state: CachedMCState, toolUseId: string): void {
  state.registeredTools?.add?.(toolUseId)
}

export function registerToolMessage(_state: CachedMCState, _toolUseIds: string[]): void {}

export function getToolResultsToDelete(_state: CachedMCState): string[] {
  return []
}

export function createCacheEditsBlock(
  _state: CachedMCState,
  _toolUseIds: string[],
): CacheEditsBlock | null {
  return null
}
