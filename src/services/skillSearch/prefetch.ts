import type { Attachment } from '../../utils/attachments.js'

export function prefetchSkillSearch(..._args: any[]): void {}
export function startSkillDiscoveryPrefetch(..._args: any[]): Promise<Attachment[]> {
  return Promise.resolve([])
}
export function getTurnZeroSkillDiscovery(..._args: any[]): Promise<Attachment[]> {
  return Promise.resolve([])
}
export async function collectSkillDiscoveryPrefetch(
  pending: Promise<Attachment[]> | Attachment[],
): Promise<Attachment[]> {
  return await pending
}
