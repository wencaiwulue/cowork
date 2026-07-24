export async function loadRemoteSkills(): Promise<unknown[]> {
  return []
}

export async function loadRemoteSkill(
  _slug: string,
  _url: string,
): Promise<{ ok: false; error: string } | { ok: true; content: string }> {
  return { ok: false, error: 'remote skills are unavailable' }
}
