export function getRemoteSkillState(): unknown {
  return undefined
}

export function stripCanonicalPrefix(name: string): string | null {
  return name.startsWith('_canonical_') ? name.slice('_canonical_'.length) : null
}

export function getDiscoveredRemoteSkill(
  _slug: string,
): { url: string; name?: string } | null {
  return null
}
