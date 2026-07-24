export async function acquireServerLock(): Promise<void> {}
export async function writeServerLock(..._args: any[]): Promise<void> {}
export async function removeServerLock(): Promise<void> {}
export async function probeRunningServer(): Promise<
  { pid: number; httpUrl: string } | undefined
> {
  return undefined
}
