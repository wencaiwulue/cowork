import type { ClaudeDesktopApi } from '../preload/preload'

declare global {
  var MonacoEnvironment: {
    getWorker(): Worker
  }

  interface Window {
    claudeDesktop: ClaudeDesktopApi
    __claudeDesktopSmokeEditor?: {
      setValue(value: string): boolean
      getValue(): string
    }
    __claudeDesktopSmokeFocusSession?: (sessionId: string) => Promise<void>
    __claudeDesktopSmokeHasUnsavedChanges?: boolean
  }
}

export {}
