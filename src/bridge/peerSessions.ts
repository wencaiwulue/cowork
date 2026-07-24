export function getPeerSessions(): unknown[] {
  return []
}

export async function postInterClaudeMessage(
  ..._args: any[]
): Promise<{ ok: true } | { ok: false; error?: string }> {
  return { ok: false, error: 'peer sessions are unavailable' }
}
