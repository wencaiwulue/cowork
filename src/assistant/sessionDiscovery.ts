export type AssistantSession = {
  id: string
  name?: string
  cwd?: string
  [key: string]: unknown
}

export async function discoverAssistantSessions(): Promise<AssistantSession[]> {
  return []
}
