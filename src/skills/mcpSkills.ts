import { memoizeWithLRU } from 'src/utils/memoize.js'

export async function getMcpSkillCommands(): Promise<unknown[]> {
  return []
}
export const fetchMcpSkillsForClient = memoizeWithLRU(
  async (_client?: unknown): Promise<unknown[]> => [],
  (_client?: unknown) =>
    String((_client as { name?: unknown })?.name ?? 'default'),
  10,
)
