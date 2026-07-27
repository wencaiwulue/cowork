export function SnapshotUpdateDialog() {
  return null
}

export function buildMergePrompt(agentType: string, scope: string): string {
  return `Merge ${agentType} updates for ${scope}.`
}
