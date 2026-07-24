type Listener = () => void

export function activateProactive(_source?: string): void {}
export function deactivateProactive(): void {}
export function pauseProactive(): void {}
export function resumeProactive(): void {}
export function setContextBlocked(_blocked: boolean): void {}

export function isProactiveActive(): boolean {
  return false
}

export function isProactivePaused(): boolean {
  return false
}

export function getNextTickAt(): number | null {
  return null
}

export function subscribeToProactiveChanges(_listener: Listener): () => void {
  return () => {}
}

export default {
  activateProactive,
  deactivateProactive,
  getNextTickAt,
  isProactiveActive,
  isProactivePaused,
  pauseProactive,
  resumeProactive,
  setContextBlocked,
  subscribeToProactiveChanges,
}
