export function isAssistantMode(): boolean {
  return false
}

export function isAssistantForced(): boolean {
  return false
}

export function markAssistantForced(): void {}

export async function initializeAssistantTeam(): Promise<void> {}

export function getAssistantSystemPromptAddendum(): string {
  return ''
}

export function getAssistantActivationPath(): string | null {
  return null
}

export default {
  getAssistantActivationPath,
  getAssistantSystemPromptAddendum,
  initializeAssistantTeam,
  isAssistantForced,
  isAssistantMode,
  markAssistantForced,
}
