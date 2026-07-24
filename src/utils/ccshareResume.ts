export async function resumeCcShare(): Promise<void> {}
export function parseCcshareId(value: string): string {
  return value
}
import type { LogOption } from '../types/logs.js'

export async function loadCcshare(_id: string): Promise<LogOption> {
  throw new Error('ccshare resume is unavailable in this build')
}
