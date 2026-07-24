export type SSHSession = any

export class SSHSessionError extends Error {}

export async function createSSHSession(..._args: any[]): Promise<SSHSession> {
  return undefined
}

export const createLocalSSHSession = createSSHSession
